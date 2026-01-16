require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const bodyParser = require('body-parser');
const path = require('path');

// Configuração do Moment Timezone
const moment = require('moment-timezone');
moment.tz.setDefault('America/Sao_Paulo');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));

// --- CONEXÃO COM POOL (ATUALIZADA) ---
const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    ssl: { rejectUnauthorized: true },
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    timezone: '+00:00' // <--- LINHA NOVA IMPORTANTE: Garante que o driver entenda UTC
});

console.log('Pool de conexões com TiDB configurado!');

// --- ROTAS ---

app.get('/', (req, res) => {
    res.render('login');
});

app.post('/login', (req, res) => {
    const { email, password } = req.body;
    const query = 'SELECT * FROM users WHERE email = ? AND password = ?';
    
    db.query(query, [email, password], (err, results) => {
        if (err) { console.error(err); return res.send("Erro no banco."); }
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

app.get('/bater-ponto', (req, res) => {
    const userId = req.query.uid;
    if (!userId) return res.redirect('/');

    db.query('SELECT * FROM users WHERE id = ?', [userId], (err, users) => {
        if (err || users.length === 0) return res.redirect('/');
        
        db.query('SELECT * FROM time_logs WHERE user_id = ? ORDER BY timestamp DESC LIMIT 1', [userId], (err, logs) => {
            const lastLog = logs && logs.length > 0 ? logs[0] : null;
            res.render('employee', { user: users[0], lastLog, moment });
        });
    });
});

app.post('/registrar', (req, res) => {
    const { userId, type } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    // MySQL usa UTC por padrão no NOW(), então inserimos direto e convertemos na leitura
    db.query('INSERT INTO time_logs (user_id, type, ip_address) VALUES (?, ?, ?)', 
    [userId, type, ip], (err) => {
        if (err) console.error("Erro ao registrar:", err);
        res.redirect(`/bater-ponto?uid=${userId}`);
    });
});

app.get('/admin', (req, res) => {
    const sql = `SELECT t.*, u.name FROM time_logs t JOIN users u ON t.user_id = u.id ORDER BY t.timestamp DESC`;
    db.query(sql, (err, logs) => {
        if (err) return res.send("Erro ao carregar.");
        res.render('admin', { logs, moment });
    });
});

app.get('/admin/delete/:id', (req, res) => {
    const id = req.params.id;
    db.query('DELETE FROM time_logs WHERE id = ?', [id], (err) => {
        res.redirect('/admin');
    });
});

app.get('/admin/edit/:id', (req, res) => {
    const id = req.params.id;
    const sql = `SELECT t.*, u.name FROM time_logs t JOIN users u ON t.user_id = u.id WHERE t.id = ?`;
    db.query(sql, [id], (err, results) => {
        if (err || results.length === 0) return res.redirect('/admin');
        res.render('edit_log', { log: results[0], moment });
    });
});

app.post('/admin/edit/:id', (req, res) => {
    const id = req.params.id;
    const { new_timestamp, new_type } = req.body;
    // Converte a hora local do input de volta para UTC antes de salvar, se necessário, 
    // mas o jeito mais simples é salvar direto e confiar na leitura.
    const sql = 'UPDATE time_logs SET timestamp = ?, type = ? WHERE id = ?';
    db.query(sql, [new_timestamp, new_type, id], (err) => {
        res.redirect('/admin');
    });
});

app.get('/exportar', (req, res) => {
    const sql = `SELECT u.name, t.type, t.timestamp, t.ip_address FROM time_logs t JOIN users u ON t.user_id = u.id ORDER BY t.timestamp DESC`;
    db.query(sql, (err, logs) => {
        if (err) return res.send("Erro exportar");
        let csv = 'Nome,Tipo,Data/Hora,IP\n';
        logs.forEach(log => {
            // Forçamos UTC -> SP aqui também
            const dataHora = moment.utc(log.timestamp).tz('America/Sao_Paulo').format('YYYY-MM-DD HH:mm:ss');
            csv += `${log.name},${log.type},${dataHora},${log.ip_address}\n`;
        });
        res.header('Content-Type', 'text/csv');
        res.attachment('relatorio.csv');
        return res.send(csv);
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`Rodando na porta ${PORT}`); });