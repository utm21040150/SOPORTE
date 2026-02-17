const { Client, LocalAuth } = require('whatsapp-web.js');
const axios = require('axios');
const qrcode = require('qrcode-terminal');
const path = require('path');
const fs = require('fs');
const express = require('express');

// ============================================
// CONFIGURACIÓN PARA RENDER
// ============================================

// Ruta persistente para la sesión en Render
const DATA_PATH = process.env.RENDER 
  ? '/opt/render/project/src/.wwebjs_auth'  // Ruta persistente en Render
  : path.join(process.cwd(), '.wwebjs_auth');

// Crear directorio si no existe
if (!fs.existsSync(DATA_PATH)) {
    fs.mkdirSync(DATA_PATH, { recursive: true });
    console.log('📁 Directorio de sesión creado:', DATA_PATH);
}

// Configuración de Puppeteer para Render
const puppeteerConfig = {
    headless: true,
    args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-extensions'
    ],
};

// ============================================
// CONFIGURACIÓN DEL CLIENTE WHATSAPP
// ============================================

const client = new Client({
    authStrategy: new LocalAuth({ 
        clientId: 'soporte-bot',
        dataPath: DATA_PATH
    }),
    webVersionCache: {
        type: 'none'
    },
    puppeteer: puppeteerConfig
});

// ============================================
// VARIABLES DE ENTORNO
// ============================================

const SHEET_API = process.env.SHEET_API || "https://script.google.com/macros/s/AKfycby_P0LSgCl7VRfHtdvP8_JhA-bxN8tiGpeuj6G25gIBEPSaoqzpNXj2mFqUp5aqs3vUzA/exec";
const LOG_ENDPOINT = process.env.LOG_ENDPOINT || null;
const ADMIN_NUMBER = process.env.ADMIN_NUMBER || null;

// Almacenamiento de sesiones de usuario
const sessions = {};

// ============================================
// FUNCIONES UTILITARIAS
// ============================================

// Retry HTTP POST con backoff
async function postWithRetry(url, data, tries = 3) {
    let delay = 500;
    for (let i = 0; i < tries; i++) {
        try {
            return await axios.post(url, data, { timeout: 8000 });
        } catch (err) {
            if (i === tries - 1) throw err;
            console.log(`Intento ${i + 1} falló, reintentando en ${delay}ms...`);
            await new Promise(r => setTimeout(r, delay));
            delay *= 2;
        }
    }
}

// Reportar errores
async function reportError(err, context = {}) {
    try {
        const payload = {
            ts: new Date().toISOString(),
            message: err && err.message ? err.message : String(err),
            stack: err && err.stack ? err.stack : null,
            context
        };

        if (LOG_ENDPOINT) {
            try { 
                await axios.post(LOG_ENDPOINT, payload, { timeout: 5000 }); 
            } catch (e) { 
                console.error('Log send failed', e.message); 
            }
        }

        if (ADMIN_NUMBER && client && client.info) {
            try {
                const text = `⚠️ Error en BOT\n${payload.message}\nuser:${context.user || '-'} step:${context.step || '-'}`;
                await client.sendMessage(ADMIN_NUMBER, text);
            } catch (e) { 
                console.error('Notify admin failed', e.message); 
            }
        }

        console.error('Reported error:', payload);
    } catch (finalErr) {
        console.error('reportError failed:', finalErr);
    }
}

// ============================================
// MANEJADORES DE EVENTOS DE WHATSAPP
// ============================================

// Manejar errores globales
process.on('unhandledRejection', (reason) => {
    console.error('Unhandled Rejection:', reason);
    reportError(reason, { type: 'unhandledRejection' });
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    reportError(err, { type: 'uncaughtException' }).finally(() => {
        // No salimos para que Render pueda reiniciar
        console.log('Error grave, pero el proceso continúa...');
    });
});

// QR Code
client.on('qr', qr => {
    // Mostrar QR en terminal (útil para desarrollo local)
    qrcode.generate(qr, { small: true });
    
    // Generar URL para ver el QR en Render
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr)}`;
    console.log('\n📱 ESCANEA ESTE QR EN LOS PRÓXIMOS 60 SEGUNDOS:');
    console.log('🔗 URL del QR:', qrUrl);
    console.log('⚠️  Si no escaneas rápido, el QR expirará\n');
    
    // Guardar QR en archivo temporal (útil para debug)
    const qrPath = path.join(DATA_PATH, 'last_qr.txt');
    fs.writeFileSync(qrPath, qr);
    
    if (LOG_ENDPOINT) {
        postWithRetry(LOG_ENDPOINT, { 
            event: 'qr', 
            url: qrUrl,
            ts: new Date().toISOString() 
        }).catch(() => {});
    }
});

// Autenticación exitosa
client.on('authenticated', (session) => {
    console.log('✅ Autenticado con WhatsApp Web');
    console.log('📁 Sesión guardada en:', DATA_PATH);
});

// Fallo de autenticación
client.on('auth_failure', msg => {
    console.error('❌ Fallo de autenticación:', msg);
    reportError(new Error('auth_failure: ' + msg), { step: 'auth_failure' });
});

// Desconexión
client.on('disconnected', reason => {
    console.warn('🔌 Cliente desconectado:', reason);
    console.log('🔄 Intentando reconectar en 10 segundos...');
    reportError(new Error('disconnected: ' + reason), { step: 'disconnected' });
    
    // Intentar reinicializar
    setTimeout(() => {
        console.log('🔄 Reinicializando cliente...');
        client.initialize();
    }, 10000);
});

// Errores del cliente
client.on('error', err => {
    console.error('❌ Error del cliente:', err);
    reportError(err, { step: 'client_error' });
});

// Cliente listo
client.on('ready', () => {
    console.log('✅ Bot de WhatsApp listo y conectado');
    console.log('👤 Número:', client.info.wid.user);
    console.log('📱 Nombre:', client.info.pushname);
});

// ============================================
// LÓGICA PRINCIPAL DEL BOT (MENSAJES)
// ============================================

client.on('message', async msg => {
    const user = msg.from;
    
    try {
        // Ignorar mensajes de grupos o estados
        if (msg.from.includes('@g.us') || msg.from.includes('status')) {
            return;
        }

        // Inicializar sesión si no existe
        if (!sessions[user]) {
            sessions[user] = { step: 0, data: {} };
        }

        const s = sessions[user];

        switch (s.step) {
            // ===== PASO 0: BIENVENIDA =====
            case 0:
                await msg.reply(
                    `*¡Hola! Bienvenido(a) al Soporte Técnico de SEDESO*\n` +
                    `A continuación te haremos una breve encuesta para generar tu ticket.\n\n` +
                    `*Indica tu nombre:*`
                );
                s.step = 1;
                break;

            // ===== PASO 1: MENÚ PRINCIPAL =====
            case 1:
                s.data.nombre = msg.body;
                await msg.reply(
                    `*${s.data.nombre}*, selecciona la opción deseada *escribiendo solo el número*:\n\n` +
                    `📋 *Menú Principal:*\n` +
                    `1️⃣ Impresoras\n` +
                    `2️⃣ Sistema SIC\n` +
                    `3️⃣ Servicio de Internet\n` +
                    `4️⃣ Telefonía\n` +
                    `5️⃣ Correo Institucional\n` +
                    `6️⃣ Soporte Técnico\n\n` +
                    `*Envía solo el número (1-6):*`
                );
                s.step = 2;
                break;

            // ===== PASO 2: SUBMENÚ =====
            case 2:
                const inputMenu = msg.body.trim().toLowerCase();

                // Opción para regresar
                if (inputMenu === '0' || inputMenu === 'regresar' || inputMenu === 'volver' || inputMenu === 'atras') {
                    await msg.reply('🔄 Regresando. Por favor indica tu nombre nuevamente:');
                    s.step = 1;
                    delete s.data.nombre;
                    return;
                }

                const numero = parseInt(inputMenu);

                if (isNaN(numero) || numero < 1 || numero > 6) {
                    await msg.reply("❌ *Opción no válida.* Por favor, envía solo un número del 1 al 6 (o 0 para regresar):");
                    return;
                }

                s.data.tipo = msg.body;
                s.data.tipo_numero = numero;

                const menus = {
                    "1": `*IMPRESORAS*\n` +
                         `Selecciona una opción *escribiendo solo el número*:\n\n` +
                         `1️⃣ Cambio de tóner\n` +
                         `2️⃣ Atasco de papel\n` +
                         `3️⃣ Revisión de cables de conexión\n` +
                         `4️⃣ Reinicio de contador\n` +
                         `0️⃣ Regresar al menú principal\n\n`,
                    
                    "2": `*SISTEMA SIC*\n` +
                         `Selecciona una opción *escribiendo solo el número*:\n\n` +
                         `1️⃣ Alta de usuario\n` +
                         `2️⃣ Creación de carpetas\n` +
                         `3️⃣ Error o fuera de servicio\n` +
                         `0️⃣ Regresar al menú principal\n\n`,
                    
                    "3": `*SERVICIO DE INTERNET*\n` +
                         `Selecciona una opción *escribiendo solo el número*:\n\n` +
                         `1️⃣ Permisos de navegación\n` +
                         `2️⃣ Revisión de conexión\n` +
                         `0️⃣ Regresar al menú principal\n\n`,
                    
                    "4": `*TELEFONÍA*\n` +
                         `Selecciona una opción *escribiendo solo el número*:\n\n` +
                         `1️⃣ Actualizar nombre del display\n` +
                         `2️⃣ Fuera de servicio\n` +
                         `3️⃣ Revisión de conexión\n` +
                         `0️⃣ Regresar al menú principal\n\n`,
                    
                    "5": `*CORREO INSTITUCIONAL*\n` +
                         `Selecciona una opción *escribiendo solo el número*:\n\n` +
                         `1️⃣ Alta de usuario\n` +
                         `2️⃣ Actualización de puesto\n` +
                         `3️⃣ Reinicio de contraseña\n` +
                         `4️⃣ Buzón lleno o sin servicio\n` +
                         `0️⃣ Regresar al menú principal\n\n`,
                    
                    "6": `*SOPORTE TÉCNICO*\n` +
                         `Selecciona una opción *escribiendo solo el número*:\n\n` +
                         `1️⃣ Respaldo de información\n` +
                         `2️⃣ Reubicación de equipo de cómputo\n` +
                         `3️⃣ Instalación de software o hardware\n` +
                         `4️⃣ Programar capacitaciones\n` +
                         `0️⃣ Regresar al menú principal\n\n`
                };

                await msg.reply(menus[numero.toString()]);
                s.step = 3;
                break;

            // ===== PASO 3: SUBOPCIÓN =====
            case 3:
                const inputSubmenu = msg.body.trim().toLowerCase();

                if (inputSubmenu === '0' || inputSubmenu === 'regresar' || inputSubmenu === 'volver' || inputSubmenu === 'atras') {
                    s.step = 2;
                    await msg.reply(
                        `🔄 Regresando al menú principal.\n\n` +
                        `*${s.data.nombre}*, selecciona la opción deseada *escribiendo solo el número*:\n\n` +
                        `📋 *Menú Principal:*\n` +
                        `1️⃣ Impresoras\n` +
                        `2️⃣ Sistema SIC\n` +
                        `3️⃣ Servicio de Internet\n` +
                        `4️⃣ Telefonía\n` +
                        `5️⃣ Correo Institucional\n` +
                        `6️⃣ Soporte Técnico\n\n` +
                        `*Por favor, envía solo el número de la opción (1-6):*`
                    );
                    return;
                }

                const subopcion = parseInt(inputSubmenu);
                
                // Definir máximo según el tipo
                let maxOpcion = 4;
                if (s.data.tipo_numero === 2) maxOpcion = 3;
                if (s.data.tipo_numero === 3) maxOpcion = 2;
                if (s.data.tipo_numero === 4) maxOpcion = 3;
                if (s.data.tipo_numero === 5) maxOpcion = 4;
                if (s.data.tipo_numero === 6) maxOpcion = 4;
                
                if (isNaN(subopcion) || subopcion < 1 || subopcion > maxOpcion) {
                    await msg.reply(`❌ *Opción no válida.* Por favor, envía solo un número del 1 al ${maxOpcion} (o 0 para regresar):`);
                    return;
                }

                s.data.problema = `Opción ${subopcion}`;
                s.data.problema_numero = subopcion;

                // Descripciones de problemas
                const descripciones = {
                    "1": { "1": "Cambio de tóner", "2": "Atasco de papel", "3": "Revisión de cables de conexión", "4": "Reinicio de contador" },
                    "2": { "1": "Alta de usuario", "2": "Creación de carpetas", "3": "Error o fuera de servicio" },
                    "3": { "1": "Permisos de navegación", "2": "Revisión de conexión" },
                    "4": { "1": "Actualizar nombre del display", "2": "Fuera de servicio", "3": "Revisión de conexión" },
                    "5": { "1": "Alta de usuario", "2": "Actualización de puesto", "3": "Reinicio de contraseña", "4": "Buzón lleno o sin servicio" },
                    "6": { "1": "Respaldo de información", "2": "Reubicación de equipo de cómputo", "3": "Instalación de software o hardware", "4": "Programar capacitaciones" }
                };

                const tipoStr = s.data.tipo_numero.toString();
                const subopcionStr = subopcion.toString();

                if (descripciones[tipoStr] && descripciones[tipoStr][subopcionStr]) {
                    s.data.problema_descripcion = descripciones[tipoStr][subopcionStr];
                } else {
                    s.data.problema_descripcion = `Problema ${subopcion}`;
                }

                await msg.reply(
                    `✅ *${s.data.problema_descripcion}*\n\n` +
                    `*¿Cuál es tu área de trabajo? (Dirección y departamento)*\n\n`
                );
                s.step = 4;
                break;

            // ===== PASO 4: GUARDAR UBICACIÓN Y ENVIAR A SHEETS =====
            case 4:
                s.data.ubicacion = msg.body;
                s.data.id = "SRV-" + Date.now();
                s.data.fecha = new Date().toLocaleString();

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

                    await msg.reply(
                        `🎫 *Ticket generado correctamente*\n\n` +
                        `📋 *ID:* ${s.data.id}\n` +
                        `👤 *Nombre:* ${s.data.nombre}\n` +
                        `🔧 *Tipo:* ${s.data.tipo}\n` +
                        `📝 *Problema:* ${problemaDesc}\n` +
                        `📅 *Fecha:* ${s.data.fecha}\n\n` +
                        `_Gracias por comunicarte con soporte técnico de SEDESO._\n` +
                        `_Tu solicitud será atendida en breve._`
                    );

                    // Notificar al administrador
                    if (ADMIN_NUMBER) {
                        try {
                            await client.sendMessage(
                                ADMIN_NUMBER,
                                `📢 *Nuevo ticket generado*\n\n` +
                                `ID: ${s.data.id}\n` +
                                `Usuario: ${s.data.nombre}\n` +
                                `Problema: ${problemaDesc}\n` +
                                `Área: ${s.data.ubicacion}`
                            );
                        } catch (e) {
                            console.error('No se pudo notificar al admin:', e);
                        }
                    }

                } catch (error) {
                    console.error('Error al enviar a Google Sheets:', error);
                    await reportError(error, { step: 'google_sheets', user });
                    
                    await msg.reply(
                        `⚠️ *Ticket generado pero hubo un error al guardarlo*\n\n` +
                        `📋 *ID:* ${s.data.id}\n` +
                        `👤 *Nombre:* ${s.data.nombre}\n\n` +
                        `_Por favor contacta manualmente al soporte técnico._`
                    );
                }

                // Limpiar sesión
                delete sessions[user];
                break;

            default:
                delete sessions[user];
                await msg.reply('🔄 Reiniciando conversación. Por favor escribe "Hola" para comenzar.');
        }

    } catch (err) {
        console.error('Error en message handler:', err);
        try {
            await reportError(err, { 
                user: msg.from, 
                body: msg.body, 
                step: sessions[msg.from]?.step || 'unknown' 
            });
        } catch (e) { 
            console.error('reportError failure', e); 
        }
        
        try { 
            await msg.reply('Disculpa, ocurrió un error procesando tu solicitud. Intenta nuevamente más tarde.'); 
        } catch (e) { }
    }
});

// ============================================
// SERVIDOR HEALTH CHECK PARA RENDER
// ============================================

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware básico
app.use(express.json());

// Ruta principal
app.get('/', (req, res) => {
    res.send(`
        <html>
            <head><title>Bot WhatsApp SEDESO</title></head>
            <body style="font-family: Arial; text-align: center; padding: 50px;">
                <h1>✅ Bot de WhatsApp SEDESO</h1>
                <p>Estado: <strong style="color: green;">ACTIVO</strong></p>
                <p>El bot está funcionando correctamente.</p>
                <hr>
                <p><small>Powered by whatsapp-web.js en Render</small></p>
            </body>
        </html>
    `);
});

// Health check para Render y UptimeRobot
app.get('/health', (req, res) => {
    const status = client.info ? 'connected' : 'connecting';
    res.status(200).json({ 
        status: 'ok', 
        bot: status,
        timestamp: new Date().toISOString()
    });
});

// Iniciar servidor
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor de health check escuchando en puerto ${PORT}`);
    console.log(`📊 Health check URL: http://localhost:${PORT}/health`);
});

// ============================================
// INICIALIZAR BOT CON REINTENTOS
// ============================================

async function initializeBot(retries = 5) {
    for (let i = 0; i < retries; i++) {
        try {
            console.log(`\n🔄 Iniciando bot (intento ${i + 1}/${retries})...`);
            console.log('📁 Usando ruta de datos:', DATA_PATH);
            
            await client.initialize();
            console.log('✅ Bot inicializado exitosamente.');
            return;
        } catch (err) {
            console.error(`❌ Error al inicializar (intento ${i + 1}):`, err.message);
            
            if (err.message.includes('Could not find Chromium')) {
                console.log('🔧 Error de Chromium. Asegúrate de que puppeteer está instalado correctamente.');
            }
            
            if (i < retries - 1) {
                const waitTime = 5000 * (i + 1); // Aumenta el tiempo de espera
                console.log(`⏳ Esperando ${waitTime/1000} segundos antes del siguiente intento...`);
                await new Promise(r => setTimeout(r, waitTime));
            } else {
                console.error('❌ No se pudo inicializar el bot después de varios intentos.');
                console.log('💡 El bot se reiniciará automáticamente en 30 segundos...');
                
                // En lugar de salir, esperamos y reintentamos
                setTimeout(() => {
                    console.log('🔄 Reintentando inicialización...');
                    initializeBot(retries);
                }, 30000);
            }
        }
    }
}

// Iniciar el bot
console.log('='.repeat(50));
console.log('🤖 BOT DE WHATSAPP - SOPORTE SEDESO');
console.log('='.repeat(50));
console.log('📱 Versión:', require('./package.json').version);
console.log('🌍 Entorno:', process.env.RENDER ? 'Render' : 'Local');
console.log('='.repeat(50));

initializeBot();

// Exportar para mantener el proceso vivo
module.exports = app;