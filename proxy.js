const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

// Configura estas variables si lo deseas o usa las del archivo bot.js
const SHEET_API = process.env.SHEET_API || 'https://script.google.com/macros/s/AKfycby_P0LSgCl7VRfHtdvP8_JhA-bxN8tiGpeuj6G25gIBEPSaoqzpNXj2mFqUp5aqs3vUzA/exec';

// Endpoint de proxy para lectura (GET)
app.get('/sheet-proxy', async (req, res) => {
    try {
        const url = SHEET_API + (req.url.includes('?') ? '&' : '?') + req.url.replace('/sheet-proxy', '').replace(/^\?/, '');
        const r = await axios.get(url, { timeout: 10000 });
        res.set('Access-Control-Allow-Origin', '*');
        res.set('Content-Type', r.headers['content-type'] || 'application/json');
        return res.status(r.status).send(r.data);
    } catch (err) {
        res.set('Access-Control-Allow-Origin', '*');
        return res.status(500).json({ error: String(err.message || err) });
    }
});

// Endpoint para recibir logs/errors desde el bot
app.post('/log', async (req, res) => {
    try {
        console.log('[LOG]', req.body);
        // Aquí podrías persistir en archivo o en una hoja de Google distinta
        res.set('Access-Control-Allow-Origin', '*');
        return res.json({ ok: true });
    } catch (err) {
        res.set('Access-Control-Allow-Origin', '*');
        return res.status(500).json({ error: String(err.message || err) });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy running on http://localhost:${PORT}`));
