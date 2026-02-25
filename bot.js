const { Client, LocalAuth } = require('whatsapp-web.js');
const puppeteer = require('puppeteer');
const axios = require('axios');
const qrcode = require('qrcode-terminal');
const path = require('path');
const os = require('os');

// Carpeta temporal para sesión (Render compatible)
const dataPath = process.env.WHATSAPP_DATA_PATH || path.join(os.tmpdir(), 'whatsapp-bot-session');

const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: dataPath
    }),
    puppeteer: {
        headless: true,
        executablePath: puppeteer.executablePath(), // 👈 ESTA ES LA CLAVE
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu'
        ]
    }
});

const SHEET_API = process.env.SHEET_API || "https://script.google.com/macros/s/AKfycby_P0LSgCl7VRfHtdvP8_JhA-bxN8tiGpeuj6G25gIBEPSaoqzpNXj2mFqUp5aqs3vUzA/exec";

// Optional: endpoint to receive logs (you can point to proxy /log)
const LOG_ENDPOINT = process.env.LOG_ENDPOINT || null;
const ADMIN_NUMBER = process.env.ADMIN_NUMBER || null;

const sessions = {};

// Utility: retry HTTP POST with backoff
async function postWithRetry(url, data, tries = 3) {
    let delay = 500;
    for (let i = 0; i < tries; i++) {
        try {
            return await axios.post(url, data, { timeout: 8000 });
        } catch (err) {
            if (i === tries - 1) throw err;
            await new Promise(r => setTimeout(r, delay));
            delay *= 2;
        }
    }
}

// Report errors to remote LOG_ENDPOINT and notify admin via WhatsApp
async function reportError(err, context = {}) {
    try {
        const payload = {
            ts: new Date().toISOString(),
            message: err && err.message ? err.message : String(err),
            stack: err && err.stack ? err.stack : null,
            context
        };

        if (LOG_ENDPOINT) {
            try { await axios.post(LOG_ENDPOINT, payload, { timeout: 5000 }); } catch (e) { console.error('Log send failed', e.message); }
        }

        if (ADMIN_NUMBER && client && client.info) {
            try {
                const text = `⚠️ Error en BOT\n${payload.message}\nuser:${context.user || '-'} step:${context.step || '-'}`;
                await client.sendMessage(ADMIN_NUMBER, text);
            } catch (e) { console.error('Notify admin failed', e.message); }
        }

        console.error('Reported error:', payload);
    } catch (finalErr) {
        console.error('reportError failed:', finalErr);
    }
}

process.on('unhandledRejection', (r) => {
    reportError(r, { type: 'unhandledRejection' });
});

process.on('uncaughtException', (err) => {
    reportError(err, { type: 'uncaughtException' }).finally(() => process.exit(1));
});

client.on('qr', qr => {
    qrcode.generate(qr, { small: true });
    console.log('QR generado. Escanea con tu celular.');
    if (LOG_ENDPOINT) {
        postWithRetry(LOG_ENDPOINT, { event: 'qr', ts: new Date().toISOString() }).catch(() => { });
    }
});

client.on('authenticated', (session) => {
    console.log('Authenticated with WhatsApp Web (session saved).');
});

client.on('auth_failure', msg => {
    console.error('Authentication failure:', msg);
    reportError(new Error('auth_failure: ' + msg), { step: 'auth_failure' });
});

client.on('disconnected', reason => {
    console.warn('Client disconnected:', reason);
    reportError(new Error('disconnected: ' + reason), { step: 'disconnected' });
});

client.on('error', err => {
    console.error('Client error:', err);
    reportError(err, { step: 'client_error' });
});

client.on('ready', () => {
    console.log(' Bot listo y conectado');
});

client.on('message', async msg => {
    const user = msg.from;
    try {
        if (!sessions[user]) {
            sessions[user] = { step: 0, data: {} };
        }

        const s = sessions[user];

        switch (s.step) {

            // BIENVENIDA
            case 0:
                msg.reply(
                    `*¡Hola!, Bienvenido(a) al Soporte Técnico de SEDESO*
A continuación te haremos una breve encuesta para generar tu ticket.

 *Indica tu nombre:*`
                );
                s.step = 1;
                break;

            // MENU PRINCIPAL
            case 1:
                s.data.nombre = msg.body;
                msg.reply(
                    `*${s.data.nombre}*, selecciona la opción deseada *escribiendo solo el número*:

📋 *Menú Principal:*
1️ Impresoras
2️ Sistema SIC
3️ Servicio de Internet
4️ Telefonía
5️ Correo Institucional
6️ Soporte Técnico

*Envía solo el número (1-6):*`
                );
                s.step = 2;
                break;

            // MENÚ PRINCIPAL - CORRECCIÓN: Añadir opción de regresar
            case 2:
                const inputMenu = msg.body.trim().toLowerCase();

                // Opción para regresar (cambiar nombre)
                if (inputMenu === '0' || inputMenu === 'regresar' || inputMenu === 'volver' || inputMenu === 'atras') {
                    msg.reply('🔄 Regresando. Por favor indica tu nombre nuevamente:');
                    s.step = 1;
                    delete s.data.nombre; // Limpiar nombre anterior
                    return;
                }

                // Validar que sea un número entre 1 y 6
                const numero = parseInt(inputMenu);

                if (isNaN(numero) || numero < 1 || numero > 6) {
                    msg.reply("❌ *Opción no válida.* Por favor, envía solo un número del 1 al 6 (o 0 para regresar):");
                    return;
                }

                s.data.tipo = msg.body;
                s.data.tipo_numero = numero;

                const menus = {
                    "1": `*IMPRESORAS*\n` +
                        `Selecciona una opción *escribiendo solo el número*:\n\n` +
                        `1️ Cambio de tóner\n` +
                        `2️ Atasco de papel\n` +
                        `3️ Revisión de cables de conexión\n` +
                        `4️ Reinicio de contador\n` +
                        `0️ Regresar al menú principal\n\n`,


                    "2": `*SISTEMA SIC*\n` +
                        `Selecciona una opción *escribiendo solo el número*:\n\n` +
                        `1️ Alta de usuario\n` +
                        `2️ Creación de carpetas\n` +
                        `3️ Error o fuera de servicio\n` +
                        `0️ Regresar al menú principal\n\n`,


                    "3": `*SERVICIO DE INTERNET*\n` +
                        `Selecciona una opción *escribiendo solo el número*:\n\n` +
                        `1️ Permisos de navegación\n` +
                        `2️ Revisión de conexión\n` +
                        `0️ Regresar al menú principal\n\n`,


                    "4": `*TELEFONÍA*\n` +
                        `Selecciona una opción *escribiendo solo el número*:\n\n` +
                        `1️ Actualizar nombre del display\n` +
                        `2️ Fuera de servicio\n` +
                        `3️ Revisión de conexión\n` +
                        `0️ Regresar al menú principal\n\n`,


                    "5": `*CORREO INSTITUCIONAL*\n` +
                        `Selecciona una opción *escribiendo solo el número*:\n\n` +
                        `1️ Alta de usuario\n` +
                        `2️ Actualización de puesto\n` +
                        `3️ Reinicio de contraseña\n` +
                        `4️ Buzón lleno o sin servicio\n` +
                        `0️ Regresar al menú principal\n\n`,


                    "6": `*SOPORTE TÉCNICO*\n` +
                        `Selecciona una opción *escribiendo solo el número*:\n\n` +
                        `1️ Respaldo de información\n` +
                        `2️ Reubicación de equipo de cómputo\n` +
                        `3️ Instalación de software o hardware\n` +
                        `4️ Programar capacitaciones\n` +
                        `0️ Regresar al menú principal\n\n`
                };

                msg.reply(menus[numero.toString()]);
                s.step = 3;
                break;

            // CORRECCIÓN: Directamente a ubicación después de seleccionar subopción
            case 3:
                const inputSubmenu = msg.body.trim().toLowerCase();

                // Opción para regresar al menú principal
                if (inputSubmenu === '0' || inputSubmenu === 'regresar' || inputSubmenu === 'volver' || inputSubmenu === 'atras') {
                    msg.reply(
                        `🔄 Regresando al menú principal.\n\n` +
                        `*${s.data.nombre}*, selecciona la opción deseada *escribiendo solo el número*:\n\n` +
                        `📋 *Menú Principal:*\n` +
                        `1️ Impresoras\n` +
                        `2️ Sistema SIC\n` +
                        `3️ Servicio de Internet\n` +
                        `4️ Telefonía\n` +
                        `5️ Correo Institucional\n` +
                        `6️ Soporte Técnico\n\n` +
                        `*Por favor, envía solo el número de la opción (1-6):*`
                    );
                    s.step = 2; // Volver al paso 2 (menú principal)
                    return;
                }

                // CORRECCIÓN: Declarar subopcion PRIMERO
                const subopcion = parseInt(inputSubmenu);

                // CORRECCIÓN: Definir maxOpcion según el tipo
                let maxOpcion = 4; // Valor por defecto

                // Definir máximo según el tipo
                if (s.data.tipo_numero === 2) maxOpcion = 3; // SIC
                if (s.data.tipo_numero === 3) maxOpcion = 2; // Internet
                if (s.data.tipo_numero === 4) maxOpcion = 3; // Telefonía
                if (s.data.tipo_numero === 5) maxOpcion = 4; // Correo
                if (s.data.tipo_numero === 6) maxOpcion = 4; // Soporte Técnico

                // CORRECCIÓN: Ahora sí podemos usar subopcion
                if (isNaN(subopcion) || subopcion < 1 || subopcion > maxOpcion) {
                    msg.reply(`❌ *Opción no válida.* Por favor, envía solo un número del 1 al ${maxOpcion} (o 0 para regresar):`);
                    return;
                }

                // Guardar la subopción seleccionada como problema
                s.data.problema = `Opción ${subopcion}`;
                s.data.problema_numero = subopcion;

                // Generar descripción automática según la selección
                const descripciones = {
                    "1": {
                        "1": "Cambio de tóner",
                        "2": "Atasco de papel",
                        "3": "Revisión de cables de conexión",
                        "4": "Reinicio de contador"
                    },
                    "2": {
                        "1": "Alta de usuario",
                        "2": "Creación de carpetas",
                        "3": "Error o fuera de servicio"
                    },
                    "3": {
                        "1": "Permisos de navegación",
                        "2": "Revisión de conexión"
                    },
                    "4": {
                        "1": "Actualizar nombre del display",
                        "2": "Fuera de servicio",
                        "3": "Revisión de conexión"
                    },
                    "5": {
                        "1": "Alta de usuario",
                        "2": "Actualización de puesto",
                        "3": "Reinicio de contraseña",
                        "4": "Buzón lleno o sin servicio"
                    },
                    "6": {
                        "1": "Respaldo de información",
                        "2": "Reubicación de equipo de cómputo",
                        "3": "Instalación de software o hardware",
                        "4": "Programar capacitaciones"
                    }
                };

                const tipoStr = s.data.tipo_numero.toString();
                const subopcionStr = subopcion.toString(); // CORRECCIÓN: Definir subopcionStr

                if (descripciones[tipoStr] && descripciones[tipoStr][subopcionStr]) {
                    s.data.problema_descripcion = descripciones[tipoStr][subopcionStr];
                } else {
                    s.data.problema_descripcion = `Problema ${subopcion}`;
                }

                msg.reply(
                    `✅ *${s.data.problema_descripcion}*\n\n` +
                    `*¿Cuál es tu área de trabajo? (Dirección y departamento)*\n\n`
                );
                s.step = 4;
                break;

            // ID y ENVÍO (recoge ubicacion y envía)
            case 4:
                s.data.ubicacion = msg.body;
                s.data.id = "SRV-" + Date.now();
                s.data.fecha = new Date().toLocaleString();

                // CORRECCIÓN: Usar valores por defecto si no existen
                const problemaDesc = s.data.problema_descripcion || s.data.problema || "No especificado";
                const problemaNum = s.data.problema_numero || 0;

                try {
                    await axios.post(SHEET_API, {
                        id: s.data.id,
                        nombre: s.data.nombre,
                        tipo: s.data.tipo,
                        tipo_numero: s.data.tipo_numero,
                        problema: problemaDesc,
                        problema_numero: problemaNum,
                        ubicacion: s.data.ubicacion,
                        fecha: s.data.fecha
                    });

                    msg.reply(
                        `🎫 *Ticket generado correctamente*\n\n` +
                        `📋 *ID:* ${s.data.id}\n` +
                        `👤 *Nombre:* ${s.data.nombre}\n` +
                        `🔧 *Tipo:* ${s.data.tipo}\n` +
                        `📝 *Problema:* ${problemaDesc}\n` +
                        `📅 *Fecha:* ${s.data.fecha}\n\n` +
                        `_Gracias por comunicarte con soporte técnico de SEDESO._\n` +
                        `_Tu solicitud será atendida en breve._`
                    );
                } catch (error) {
                    console.error('Error al enviar a Google Sheets:', error);
                    msg.reply(
                        `⚠️ *Ticket generado pero hubo un error al guardarlo*\n\n` +
                        `📋 *ID:* ${s.data.id}\n` +
                        `👤 *Nombre:* ${s.data.nombre}\n\n` +
                        `_Por favor contacta manualmente al soporte técnico._`
                    );
                }

                delete sessions[user];
                break;
        }
    } catch (err) {
        console.error('Error en message handler:', err);
        try {
            await reportError(err, { user: msg.from, body: msg.body, step: (sessions[msg.from] && sessions[msg.from].step) || null });
        } catch (e) { console.error('reportError failure', e); }
        try { await msg.reply('Disculpa, ocurrió un error procesando tu solicitud. Intenta nuevamente más tarde.'); } catch (e) { }
    }
});

// ... (todo tu código anterior) ...

// ============================================
// ✅ SERVIDOR WEB PARA RENDER
// ============================================
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Servir archivos estáticos
app.use(express.static(__dirname));

// Ruta principal - sirve tu index.html
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// Health check para UptimeRobot
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// Iniciar servidor
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Servidor web corriendo en puerto ${PORT}`);
    console.log(`📱 Accede a: http://localhost:${PORT} (local) o en tu URL de Render`);
});

// Initialize with retry logic and better error handling
async function initializeBot(retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            console.log(`Iniciando bot (intento ${i + 1}/${retries})...`);
            await client.initialize();
            console.log('Bot inicializado exitosamente.');
            return;
        } catch (err) {
            console.error(`Error al inicializar (intento ${i + 1}):`, err.message);
            if (i < retries - 1) {
                await new Promise(r => setTimeout(r, 3000));
            } else {
                console.error('No se pudo inicializar el bot después de varios intentos.');
                reportError(err, { step: 'initialize_failed', retries });
                process.exit(1);
            }
        }
    }
}

initializeBot();
