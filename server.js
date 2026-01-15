require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const bodyParser = require('body-parser');
const path = require('path');
const moment = require('moment'); // Para formatar datas

const app = express();

// Configuração da View Engine (EJS)
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));

// Conexão com TiDB Cloud (SSL é obrigatório na maioria dos clusters TiDB)
const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    ssl: {
        rejectUnauthorized: true // Garante conexão segura
    }
});

db.connect(err => {
    if (err) console.error('Erro ao conectar no TiDB:', err);
    else console.log('Conectado ao TiDB Cloud com sucesso!');
});

// --- ROTAS ---

// 1. Tela de Login
app.get('/', (req, res) => {
    res.render('login');
});

// 2. Processar Login (Simples)
app.post('/login', (req, res) => {
    const { email, password } = req.body;
    // Atenção: Em produção, use bcrypt para comparar hashes
    const query = 'SELECT * FROM users WHERE email = ? AND password = ?';
    
    db.query(query, [email, password], (err, results) => {
        if (err) throw err;
        if (results.length > 0) {
            const user = results[0];
            if (user.role === 'admin') {
                res.redirect(`/admin?uid=${user.id}`);
            } else {
                res.redirect(`/bater-ponto?uid=${user.id}`);
            }
        } else {
            res.send('<script>alert("Login inválido"); window.location.href="/"</script>');
        }
    });
});

// 3. Área do Funcionário (Mobile First)
app.get('/bater-ponto', (req, res) => {
    const userId = req.query.uid;
    // Buscar último registro para saber o estado atual
    db.query('SELECT * FROM users WHERE id = ?', [userId], (err, users) => {
        if(users.length === 0) return res.redirect('/');
        
        db.query('SELECT * FROM time_logs WHERE user_id = ? ORDER BY timestamp DESC LIMIT 1', [userId], (err, logs) => {
            const lastLog = logs[0];
            res.render('employee', { user: users[0], lastLog, moment });
        });
    });
});

// 4. Registrar Ponto (POST)
app.post('/registrar', (req, res) => {
    const { userId, type } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    db.query('INSERT INTO time_logs (user_id, type, ip_address) VALUES (?, ?, ?)', 
    [userId, type, ip], (err) => {
        if (err) console.error(err);
        res.redirect(`/bater-ponto?uid=${userId}`);
    });
});

// 5. Área de Gestão (Admin)
app.get('/admin', (req, res) => {
    // Busca todos os registros com join no usuário
    const sql = `
        SELECT t.*, u.name 
        FROM time_logs t 
        JOIN users u ON t.user_id = u.id 
        ORDER BY t.timestamp DESC`;
        
    db.query(sql, (err, logs) => {
        res.render('admin', { logs, moment });
    });
});

app.listen(process.env.PORT, () => {
    console.log(`Servidor rodando em http://localhost:${process.env.PORT}`);
});