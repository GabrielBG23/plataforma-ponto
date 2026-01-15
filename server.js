require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const bodyParser = require('body-parser');
const path = require('path');
const moment = require('moment');

const app = express();

// Configuração da View Engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));

// --- MUDANÇA PRINCIPAL AQUI: USANDO POOL ---
// O Pool mantém várias conexões abertas e recria elas se caírem.
const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    ssl: {
        rejectUnauthorized: true
    },
    waitForConnections: true,
    connectionLimit: 10, // Mantém até 10 conexões simultâneas
    queueLimit: 0
});

console.log('Pool de conexões com TiDB configurado!');

// --- ROTAS ---

// 1. Tela de Login
app.get('/', (req, res) => {
    res.render('login');
});

// 2. Processar Login
app.post('/login', (req, res) => {
    const { email, password } = req.body;
    
    const query = 'SELECT * FROM users WHERE email = ? AND password = ?';
    
    db.query(query, [email, password], (err, results) => {
        if (err) {
            console.error(err);
            return res.send("Erro no banco de dados. Tente novamente.");
        }
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

// 3. Área do Funcionário
app.get('/bater-ponto', (req, res) => {
    const userId = req.query.uid;
    
    if (!userId) return res.redirect('/');

    db.query('SELECT * FROM users WHERE id = ?', [userId], (err, users) => {
        if (err) {
            console.error(err);
            return res.redirect('/');
        }
        if(users.length === 0) return res.redirect('/');
        
        db.query('SELECT * FROM time_logs WHERE user_id = ? ORDER BY timestamp DESC LIMIT 1', [userId], (err, logs) => {
            if (err) console.error(err);
            const lastLog = logs && logs.length > 0 ? logs[0] : null;
            res.render('employee', { user: users[0], lastLog, moment });
        });
    });
});

// 4. Registrar Ponto
app.post('/registrar', (req, res) => {
    const { userId, type } = req.body;
    // Pega o IP real mesmo estando atrás do proxy do Render
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    db.query('INSERT INTO time_logs (user_id, type, ip_address) VALUES (?, ?, ?)', 
    [userId, type, ip], (err) => {
        if (err) console.error("Erro ao registrar ponto:", err);
        res.redirect(`/bater-ponto?uid=${userId}`);
    });
});

// 5. Área de Gestão (Admin)
app.get('/admin', (req, res) => {
    const sql = `
        SELECT t.*, u.name 
        FROM time_logs t 
        JOIN users u ON t.user_id = u.id 
        ORDER BY t.timestamp DESC`;
        
    db.query(sql, (err, logs) => {
        if (err) {
            console.error(err);
            return res.send("Erro ao carregar relatório.");
        }
        res.render('admin', { logs, moment });
    });
});

// Inicia o servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});