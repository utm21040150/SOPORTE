
const SHEET_URL = "https://script.google.com/macros/s/AKfycby_P0LSgCl7VRfHtdvP8_JhA-bxN8tiGpeuj6G25gIBEPSaoqzpNXj2mFqUp5aqs3vUzA/exec";

const tabla = document.getElementById("tablaServicios");

function normalizeLabel(s) {
    return (s || "").toString().trim().toLowerCase();
}

function buildSelect(options, selected, className) {
    return `<select class="${className}">` + options.map(o => `
        <option value="${o}" ${o === selected ? 'selected' : ''}>${o}</option>`).join('') + `</select>`;
}

function estadoClassFromValue(v) {
    if (!v) return '';
    const n = normalizeLabel(v);
    if (n.includes('abierto')) return 'abierto';
    if (n.includes('proceso')) return 'proceso';
    if (n.includes('cerrado')) return 'cerrado';
    return '';
}

function prioridadClassFromValue(v) {
    if (!v) return 'prioridad-baja';
    const n = normalizeLabel(v);
    if (n.includes('alta')) return 'prioridad-alta';
    if (n.includes('media')) return 'prioridad-media';
    return 'prioridad-baja';
}

function updateCounters() {
    const rows = Array.from(tabla.querySelectorAll('tr'));
    let total = rows.length, abiertos = 0, proceso = 0, cerrados = 0;
    rows.forEach(r => {
        const sel = r.querySelector('.estado-select');
        const val = sel ? sel.value : '';
        const n = normalizeLabel(val);
        if (n.includes('abierto')) abiertos++;
        else if (n.includes('proceso')) proceso++;
        else if (n.includes('cerrado')) cerrados++;
    });
    document.getElementById('total').textContent = total;
    document.getElementById('abiertos').textContent = abiertos;
    document.getElementById('proceso').textContent = proceso;
    document.getElementById('cerrados').textContent = cerrados;
}

function attachRowListeners(row) {
    const estadoSel = row.querySelector('.estado-select');
    const prioridadSel = row.querySelector('.prioridad-select');

    if (estadoSel) {
        estadoSel.addEventListener('change', () => {
            const v = estadoSel.value;
            estadoSel.classList.remove('abierto', 'proceso', 'cerrado');
            const estClass = estadoClassFromValue(v);
            if (estClass) estadoSel.classList.add(estClass);
            updateCounters();
            console.log('Estado cambiado:', v);
        });
    }

    if (prioridadSel) {
        prioridadSel.addEventListener('change', () => {
            const v = prioridadSel.value;
            const td = prioridadSel.closest('td');
            td.classList.remove('prioridad-alta', 'prioridad-media', 'prioridad-baja');
            td.classList.add(prioridadClassFromValue(v));
            prioridadSel.classList.remove('prioridad-alta', 'prioridad-media', 'prioridad-baja');
            prioridadSel.classList.add(prioridadClassFromValue(v));
            const calCell = row.querySelector('.calificacion-cell');
            if (calCell) {
                calCell.classList.remove('prioridad-alta', 'prioridad-media', 'prioridad-baja');
                calCell.classList.add(prioridadClassFromValue(v));
            }
            console.log('Prioridad cambiada:', v);
        });
    }
}

function renderFromRows(jsonRows, cols) {
    tabla.innerHTML = '';
    const headerMap = {};
    cols.forEach((c, i) => headerMap[normalizeLabel(c)] = i);

    const find = (row, names) => {
        for (const nm of names) {
            const idx = headerMap[normalizeLabel(nm)];
            if (idx !== undefined) {
                const cell = row.c[idx];
                if (cell && cell.v !== undefined) return cell.v;
            }
        }
        return '';
    };

    jsonRows.forEach(r => {
        const id = find(r, ['id', 'idd', 'identificador']);
        const nombre = find(r, ['nombre', 'name']);
        const tipo = find(r, ['tipo', 'tipo de servicio', 'servicio']);
        const problema = find(r, ['problema', 'descripcion', 'detalle']);
        const ubicacion = find(r, ['ubicación', 'ubicacion', 'lugar']);
        const estado = find(r, ['estado', 'status']);
        const prioridad = find(r, ['prioridad', 'priority']);
        const fecha = find(r, ['fecha', 'date']);

        const estadoSel = buildSelect(['Abierto', 'En Proceso', 'Cerrado'], estado, 'estado-select');
        const prioridadSel = buildSelect(['Alta', 'Media', 'Baja'], prioridad, 'prioridad-select');

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${id}</td>
            <td>${nombre}</td>
            <td>${tipo}</td>
            <td>${problema}</td>
            <td>${ubicacion}</td>
            <td class="estado-cell">${estadoSel}</td>
            <td class="prioridad-cell">${prioridadSel}</td>
            <td>${fecha}</td>
        `;

        tabla.appendChild(tr);

        // después de insertar al DOM, asignar clases iniciales a los selects y celdas para mostrar color
        const insertedEstadoSel = tr.querySelector('.estado-select');
        if (insertedEstadoSel) {
            const estClass = estadoClassFromValue(estado);
            console.log('Estado:', estado, '| Clase:', estClass);
            if (estClass) insertedEstadoSel.classList.add(estClass);
        }
        const insertedPrioridadSel = tr.querySelector('.prioridad-select');
        const prioridadCell = tr.querySelector('.prioridad-cell');
        const prClass = prioridadClassFromValue(prioridad);
        if (insertedPrioridadSel && prClass) {
            insertedPrioridadSel.classList.add(prClass);
        }
        if (prioridadCell && prClass) {
            prioridadCell.classList.remove('prioridad-alta', 'prioridad-media', 'prioridad-baja');
            prioridadCell.classList.add(prClass);
        }

        attachRowListeners(tr);
    });

    updateCounters();
}

// Fetch Google Sheets JSON via Visualization API and render
// Helper: JSONP loader (fallback cuando CORS bloquea fetch)
function loadJSONP(url, callbackName = '___sheetCallback') {
    return new Promise((resolve, reject) => {
        const cb = callbackName + '_' + Math.floor(Math.random() * 1000000);
        window[cb] = function (data) {
            resolve(data);
            try { delete window[cb]; } catch (e) { }
            const s = document.getElementById(cb + '_script');
            if (s) s.remove();
        };
        const s = document.createElement('script');
        s.id = cb + '_script';
        s.src = url + (url.includes('?') ? '&' : '?') + 'callback=' + cb;
        s.onerror = function (e) {
            reject(new Error('JSONP script load error'));
            try { delete window[cb]; } catch (er) { }
            s.remove();
        };
        document.head.appendChild(s);
    });
}

function processSheetText(text) {
    try {
        console.log('Raw response snippet:', text.substring(0, 200));
        let cleanedText = text;
        if (cleanedText.includes('{')) cleanedText = cleanedText.substring(cleanedText.indexOf('{'));
        if (cleanedText.endsWith('*/')) cleanedText = cleanedText.slice(0, -2);
        const json = JSON.parse(cleanedText);
        const rows = json.table?.rows || [];
        const cols = (json.table?.cols || []).map(c => c.label || '');
        if (rows.length === 0) {
            tabla.innerHTML = '<tr><td colspan="9">No hay datos disponibles</td></tr>';
            return;
        }
        renderFromRows(rows, cols);
    } catch (err) {
        console.error('Error parsing sheet JSON:', err);
        tabla.innerHTML = '<tr><td colspan="9">Error al cargar los datos</td></tr>';
    }
}

// Intentar fetch normal y, si falla (CORS), usar JSONP
fetch(SHEET_URL)
    .then(res => {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.text();
    })
    .then(text => processSheetText(text))
    .catch(err => {
        console.warn('Fetch falló, intentando JSONP fallback:', err);
        loadJSONP(SHEET_URL).then(data => {
            // Si el servidor soporta JSONP, la respuesta será el objeto JSON
            if (data && data.table) {
                const rows = data.table.rows || [];
                const cols = (data.table.cols || []).map(c => c.label || '');
                if (rows.length === 0) {
                    tabla.innerHTML = '<tr><td colspan="9">No hay datos disponibles</td></tr>';
                    return;
                }
                renderFromRows(rows, cols);
            } else {
                // A veces Apps Script devuelve la cadena JSON envuelta; intentar procesar como texto
                try {
                    processSheetText(JSON.stringify(data));
                } catch (e) {
                    console.error('JSONP devolvió datos no esperados', e);
                    tabla.innerHTML = '<tr><td colspan="9">Error al cargar los datos (JSONP inválido)</td></tr>';
                }
            }
        }).catch(jsErr => {
            console.error('JSONP también falló:', jsErr);
            tabla.innerHTML = '<tr><td colspan="9">Error de conexión con Google Sheets (CORS)</td></tr>';
        });
    });

