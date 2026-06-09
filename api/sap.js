// Lightweight OData Mock Server for Vercel Serverless
// NO @sap-ux/fe-mockserver-core — pure Express, instant cold start
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.text({ type: '*/*' }));

// CORS and OData headers
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    // OData V2 requires DataServiceVersion header
    res.setHeader('DataServiceVersion', '2.0');
    if (req.method === 'OPTIONS') return res.status(200).end();
    next();
});

// --- File path helpers ---
// Try multiple root candidates (local dev vs Vercel serverless)
function findRoot() {
    const candidates = [
        path.join(__dirname, '..'),
        process.cwd(),
        '/var/task'
    ];
    for (const c of candidates) {
        if (fs.existsSync(path.join(c, 'webapp', 'localService', 'metadata.xml'))) return c;
    }
    return candidates[0]; // fallback
}
const ROOT = findRoot();
const SERVICES = {
    v4: {
        prefix: '/sap/opu/odata4/sap/zui_job_manage01_o4/srvd/sap/z_sd_job_ovp/0001',
        metadataFile: path.join(ROOT, 'webapp', 'localService', 'metadata.xml'),
        dataDir: path.join(ROOT, 'webapp', 'localService', 'mockdata'),
        isV4: true
    },
    dashboard: {
        prefix: '/sap/opu/odata/sap/ZUI_JOB_OVP',
        metadataFile: path.join(ROOT, 'apps', 'dashboard', 'webapp', 'localService', 'mainService', 'metadata.xml'),
        dataDir: path.join(ROOT, 'apps', 'dashboard', 'webapp', 'localService', 'mainService', 'data'),
        isV4: false
    },
    analytic: {
        prefix: '/sap/opu/odata/sap/Z_SB_JOB',
        metadataFile: path.join(ROOT, 'apps', 'analytic', 'webapp', 'localService', 'mainService', 'metadata.xml'),
        dataDir: path.join(ROOT, 'apps', 'analytic', 'webapp', 'localService', 'mainService', 'data'),
        isV4: false
    }
};

const ANNOTATIONS = {
    'ZUI_JOB_OVP_VAN': path.join(ROOT, 'apps', 'dashboard', 'webapp', 'localService', 'mainService', 'ZUI_JOB_OVP_VAN.xml'),
    'Z_SB_JOB_VAN': path.join(ROOT, 'apps', 'analytic', 'webapp', 'localService', 'mainService', 'Z_SB_JOB_VAN.xml')
};

// --- Helpers ---
function readFileIfExists(filePath) {
    try { return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null; }
    catch (e) { return null; }
}

function readJsonData(dataDir, entityName) {
    if (!dataDir) return [];
    const filePath = path.join(dataDir, `${entityName}.json`);
    const raw = readFileIfExists(filePath);
    if (!raw) return [];
    try {
        const json = JSON.parse(raw);
        return Array.isArray(json) ? json : (json.value || (json.d && json.d.results) || []);
    } catch (e) { return []; }
}

function findService(url) {
    for (const svc of Object.values(SERVICES)) {
        if (url.startsWith(svc.prefix)) return svc;
    }
    return null;
}

function wrapResponse(data, isV4) {
    return isV4 ? { value: data } : { d: { results: data } };
}

// Wrap single entity for non-batch requests (standard express route responses)
function wrapSingle(item, isV4) {
    return isV4 ? item : { d: item };
}

// --- Debug endpoint ---
app.get('/sap/debug', (req, res) => {
    const results = {};
    for (const [name, svc] of Object.entries(SERVICES)) {
        results[name] = {
            metadataExists: fs.existsSync(svc.metadataFile),
            dataDirExists: fs.existsSync(svc.dataDir),
            dataFiles: fs.existsSync(svc.dataDir) ? fs.readdirSync(svc.dataDir) : []
        };
    }
    for (const [name, filePath] of Object.entries(ANNOTATIONS)) {
        results[`annotation_${name}`] = { exists: fs.existsSync(filePath) };
    }
    res.json({ __dirname, cwd: process.cwd(), results });
});

// --- Annotation requests ---
app.get('/sap/opu/odata/IWFND/CATALOGSERVICE*', (req, res) => {
    for (const [name, filePath] of Object.entries(ANNOTATIONS)) {
        if (req.path.includes(name)) {
            const content = readFileIfExists(filePath);
            if (content) {
                res.setHeader('Content-Type', 'application/xml;charset=utf-8');
                return res.send(content);
            }
        }
    }
    res.status(404).send('Annotation not found');
});

// --- Action Logic Helper ---
function handleActionLogic(svc, actionName, entity, allData, keys, body) {
    switch (actionName) {
        case 'StopJob': {
            if (entity) {
                entity.StatusText = 'Aborted';
                entity.Criticality = 1;
                entity.EndDate = new Date().toISOString().split('T')[0];
            }
            return entity || {};
        }
        case 'DeleteJob': {
            return {};
        }
        case 'ReleaseJob': {
            if (entity) {
                const isImmediate = body.IsImmediate === true || body.IsImmediate === 'X';
                entity.StatusText = isImmediate ? 'Active' : 'Scheduled';
                entity.Criticality = isImmediate ? 3 : 2;
            }
            return entity || {};
        }
        case 'RepeatWithSchedule': {
            const newJob = { ...(entity || {}), JobCount: String(Date.now()).slice(-6) };
            return newJob;
        }
        case 'CopyJob': {
            const newJob = {
                ...(entity || {}),
                JobName: body.NewJobName || 'Copy_' + (entity && entity.JobName),
                JobCount: String(Date.now()).slice(-6),
                StatusText: 'Scheduled',
                Criticality: 2
            };
            return newJob;
        }
        case 'ScheduleJob': {
            const newJob = {
                JobName: body.JobName || 'New Job',
                JobCount: String(Date.now()).slice(-6),
                ProgramName: body.ProgramName || '',
                VariantName: body.VariantName || '',
                StatusText: (body.IsImmediate === 'X' || body.IsImmediate === true) ? 'Active' : 'Scheduled',
                Criticality: (body.IsImmediate === 'X' || body.IsImmediate === true) ? 3 : 2,
                StartDate: body.StartDate || new Date().toISOString().split('T')[0],
                CreatedBy: 'SAP_SYSTEM',
                JobClass: 'C'
            };
            return newJob;
        }
        default:
            return entity || {};
    }
}

// --- Request Processor ---
function processODataRequest(method, pathname, query, body, svc) {
    // 1. $metadata
    if (pathname === '/$metadata' || pathname === '/$metadata/') {
        const content = readFileIfExists(svc.metadataFile);
        if (content) {
            return { status: 200, contentType: 'application/xml;charset=utf-8', body: content };
        }
        return { status: 404, contentType: 'text/plain', body: 'Metadata not found' };
    }

    // 2. Service document (root)
    if (pathname === '' || pathname === '/') {
        if (svc.isV4) {
            return {
                status: 200,
                contentType: 'application/json;odata.metadata=minimal;charset=utf-8',
                body: {
                    '@odata.context': '$metadata',
                    value: [
                        { name: 'JobList', url: 'JobList' },
                        { name: 'Z_I_ProgramVH', url: 'Z_I_ProgramVH' },
                        { name: 'Z_I_VariantVH', url: 'Z_I_VariantVH' }
                    ]
                }
            };
        } else {
            // OData V2 service document MUST be XML Atom format for UI5
            const entitySets = fs.existsSync(svc.dataDir)
                ? fs.readdirSync(svc.dataDir).map(f => f.replace('.json', ''))
                : [];
            const baseUrl = svc.prefix;
            const collectionsXml = entitySets.map(e =>
                `<collection href="${e}"><atom:title>${e}</atom:title></collection>`
            ).join('\n            ');
            const xml = `<?xml version="1.0" encoding="utf-8"?>
<service xml:base="${baseUrl}/" xmlns="http://www.w3.org/2007/app" xmlns:atom="http://www.w3.org/2005/Atom">
    <workspace>
        <atom:title>Default</atom:title>
            ${collectionsXml}
    </workspace>
</service>`;
            return { status: 200, contentType: 'application/xml;charset=utf-8', body: xml };
        }
    }

    // 3. $count
    if (pathname.endsWith('/$count')) {
        const entityName = pathname.replace('/$count', '').replace(/^\//, '').split('(')[0];
        const data = readJsonData(svc.dataDir, entityName);
        return { status: 200, contentType: 'text/plain', body: String(data.length) };
    }

    // 4. Entity set or single entity
    const entityMatch = pathname.match(/^\/([A-Za-z_]\w*)(?:\(([^)]*)\))?/);
    if (entityMatch) {
        const entityName = entityMatch[1];
        const keyStr = entityMatch[2]; // e.g. JobName='X',JobCount='001'
        const data = readJsonData(svc.dataDir, entityName);

        // Single entity by key
        if (keyStr) {
            const keyParts = {};
            keyStr.replace(/(\w+)='([^']*)'/g, (_, k, v) => { keyParts[k] = v; });
            const item = data.find(d => {
                return Object.entries(keyParts).every(([k, v]) => String(d[k]) === v);
            });
            if (item) {
                // Check for navigation property
                const navMatch = pathname.match(/\)\/(_.+)/);
                if (navMatch) {
                    const navProp = navMatch[1];
                    const navEntityName = navProp.replace(/^_/, '');
                    // Try to find nav entity data (e.g. _Steps -> JobStep)
                    const possibleNames = [navEntityName, 'Job' + navEntityName];
                    for (const name of possibleNames) {
                        const navData = readJsonData(svc.dataDir, name);
                        if (navData.length > 0) {
                            const filtered = navData.filter(d => {
                                return Object.entries(keyParts).every(([k, v]) => String(d[k]) === v);
                            });
                            const payload = wrapResponse(filtered, svc.isV4);
                            if (svc.isV4) {
                                payload['@odata.context'] = `$metadata#${entityName}(${keyStr})/${navProp}`;
                            }
                            return { status: 200, contentType: svc.isV4 ? 'application/json;odata.metadata=minimal;charset=utf-8' : 'application/json;charset=utf-8', body: payload };
                        }
                    }
                    const payload = wrapResponse([], svc.isV4);
                    if (svc.isV4) {
                        payload['@odata.context'] = `$metadata#${entityName}(${keyStr})/${navProp}`;
                    }
                    return { status: 200, contentType: svc.isV4 ? 'application/json;odata.metadata=minimal;charset=utf-8' : 'application/json;charset=utf-8', body: payload };
                }

                // Check for bound action (POST)
                if (method === 'POST') {
                    const actionMatch = pathname.match(/\)\/.*\.(\w+)$/);
                    if (actionMatch) {
                        const actResult = handleActionLogic(svc, actionMatch[1], item, data, keyParts, body);
                        const payload = wrapSingle(actResult, svc.isV4);
                        if (svc.isV4) {
                            payload['@odata.context'] = `$metadata#${entityName}/$entity`;
                        }
                        return { status: 200, contentType: svc.isV4 ? 'application/json;odata.metadata=minimal;charset=utf-8' : 'application/json;charset=utf-8', body: payload };
                    }
                }

                const payload = wrapSingle(item, svc.isV4);
                if (svc.isV4) {
                    payload['@odata.context'] = `$metadata#${entityName}/$entity`;
                }
                return { status: 200, contentType: svc.isV4 ? 'application/json;odata.metadata=minimal;charset=utf-8' : 'application/json;charset=utf-8', body: payload };
            }
            return {
                status: 404,
                contentType: svc.isV4 ? 'application/json;odata.metadata=minimal;charset=utf-8' : 'application/json;charset=utf-8',
                body: { error: { message: `Entity ${entityName} with key ${keyStr} not found` } }
            };
        }

        // DELETE single entity
        if (method === 'DELETE') {
            return { status: 204, contentType: 'text/plain', body: '' };
        }

        // Collection with $filter, $top, $skip, $orderby, $select
        let result = [...data];

        if (query.$filter) {
            // Simple filter parsing
            const filters = query.$filter.match(/(\w+)\s+eq\s+('[^']*'|\S+)/g) || [];
            for (const f of filters) {
                const m = f.match(/(\w+)\s+eq\s+('[^']*'|\S+)/);
                if (m) {
                    const field = m[1];
                    let val = m[2];
                    if (val.startsWith("'") && val.endsWith("'")) {
                        val = val.substring(1, val.length - 1);
                    }
                    result = result.filter(d => String(d[field]) === val);
                }
            }
        }

        const totalCount = result.length;

        if (query.$orderby) {
            const [field, dir] = query.$orderby.split(' ');
            result.sort((a, b) => {
                const va = a[field], vb = b[field];
                return dir === 'desc' ? (vb > va ? 1 : -1) : (va > vb ? 1 : -1);
            });
        }

        if (query.$skip) result = result.slice(parseInt(query.$skip));
        if (query.$top) result = result.slice(0, parseInt(query.$top));

        const responsePayload = wrapResponse(result, svc.isV4);
        if (svc.isV4) {
            responsePayload['@odata.context'] = `$metadata#${entityName}`;
            if (query.$count === 'true' || query.$inlinecount === 'allpages') {
                responsePayload['@odata.count'] = totalCount;
            }
        } else {
            if (query.$count === 'true' || query.$inlinecount === 'allpages') {
                responsePayload.d.__count = String(totalCount);
            }
        }
        return { status: 200, contentType: svc.isV4 ? 'application/json;odata.metadata=minimal;charset=utf-8' : 'application/json;charset=utf-8', body: responsePayload };
    }

    // Unbound action (POST to service root)
    if (method === 'POST') {
        const actionMatch = pathname.match(/^\/.*\.(\w+)$/);
        if (actionMatch) {
            const entityData = readJsonData(svc.dataDir, 'JobList');
            const actResult = handleActionLogic(svc, actionMatch[1], null, entityData, {}, body);
            const payload = wrapSingle(actResult, svc.isV4);
            if (svc.isV4) {
                payload['@odata.context'] = `$metadata#JobList/$entity`;
            }
            return { status: 200, contentType: svc.isV4 ? 'application/json;odata.metadata=minimal;charset=utf-8' : 'application/json;charset=utf-8', body: payload };
        }
    }

    return {
        status: 404,
        contentType: svc.isV4 ? 'application/json;odata.metadata=minimal;charset=utf-8' : 'application/json;charset=utf-8',
        body: { error: { message: 'Not found: ' + pathname } }
    };
}

// --- Batch request processing helper ---
function processBatchPart(partText, svc) {
    const lines = partText.split(/\r?\n/);
    const verbIndex = lines.findIndex(l => /(GET|POST|PUT|DELETE|PATCH)\s+(\S+)\s+HTTP/i.test(l));
    if (verbIndex === -1) return null;

    const lineMatch = lines[verbIndex].match(/(GET|POST|PUT|DELETE|PATCH)\s+(\S+)\s+HTTP/i);
    if (!lineMatch) return null;

    const method = lineMatch[1].toUpperCase();
    let rawPath = lineMatch[2];

    let relPath = rawPath;
    if (relPath.startsWith('http://') || relPath.startsWith('https://')) {
        try {
            relPath = new URL(relPath).pathname;
        } catch (e) {}
    }
    if (relPath.startsWith(svc.prefix)) {
        relPath = relPath.substring(svc.prefix.length);
    }
    if (!relPath.startsWith('/')) {
        relPath = '/' + relPath;
    }

    const [pathname, queryString] = relPath.split('?');
    const query = {};
    if (queryString) {
        queryString.split('&').forEach(pair => {
            const [k, v] = pair.split('=');
            if (k) query[decodeURIComponent(k)] = decodeURIComponent(v || '');
        });
    }

    // Find body of the inner request
    let innerBody = '';
    const emptyLineIndex = lines.indexOf('', verbIndex);
    if (emptyLineIndex !== -1) {
        innerBody = lines.slice(emptyLineIndex + 1).join('\r\n').trim();
    }

    let parsedBody = {};
    if (innerBody) {
        try {
            parsedBody = JSON.parse(innerBody);
        } catch (e) {}
    }

    return processODataRequest(method, pathname, query, parsedBody, svc);
}

// --- Status Text Helper ---
function getStatusText(status) {
    const statusTexts = {
        200: 'OK',
        201: 'Created',
        202: 'Accepted',
        204: 'No Content',
        400: 'Bad Request',
        401: 'Unauthorized',
        403: 'Forbidden',
        404: 'Not Found',
        500: 'Internal Server Error'
    };
    return statusTexts[status] || 'OK';
}

// --- Batch Handler ---
function handleBatch(req, res, svc) {
    const contentType = req.headers['content-type'] || '';

    // 1. For OData V4 JSON batch (if requested explicitly as JSON)
    if (contentType.includes('application/json')) {
        let body = {};
        try {
            body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
        } catch (e) { body = {}; }

        const requests = body.requests || [];
        const responses = requests.map((r, i) => {
            const rUrl = r.url || '';
            const [pathname, queryString] = ('/' + rUrl.replace(/^\//, '')).split('?');
            const query = {};
            if (queryString) {
                queryString.split('&').forEach(pair => {
                    const [k, v] = pair.split('=');
                    if (k) query[decodeURIComponent(k)] = decodeURIComponent(v || '');
                });
            }

            const result = processODataRequest(r.method || 'GET', pathname, query, r.body, svc);
            return {
                id: r.id || String(i),
                status: result.status,
                headers: { 
                    'content-type': result.contentType,
                    'odata-version': '4.0'
                },
                body: result.body
            };
        });

        res.setHeader('Content-Type', 'application/json;odata.metadata=minimal;charset=utf-8');
        res.setHeader('OData-Version', '4.0');
        return res.json({ responses });
    }

    // 2. For OData V2 or OData V4 Multipart batch (UI5 V4 ODataModel uses multipart by default)
    let boundary = '';
    const match = contentType.match(/boundary=([^;]+)/i);
    if (match) {
        boundary = match[1].trim();
    }
    if (!boundary && typeof req.body === 'string') {
        const m = req.body.match(/^--batch_[\w-]+/m);
        if (m) {
            boundary = m[0].substring(2);
        }
    }

    if (!boundary || typeof req.body !== 'string') {
        return res.status(400).send('Invalid batch request (no boundary found)');
    }

    const parts = req.body.split('--' + boundary);
    const responseBoundary = 'batch_response_' + String(Date.now());
    res.setHeader('Content-Type', `multipart/mixed; boundary=${responseBoundary}`);
    if (svc.isV4) {
        res.setHeader('OData-Version', '4.0');
    } else {
        res.setHeader('DataServiceVersion', '2.0');
    }

    let responseContent = '';

    for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed || trimmed === '--') continue;

        // Check if this part is a changeset (POST operations)
        const csMatch = trimmed.match(/Content-Type:\s*multipart\/mixed;\s*boundary=(changeset_[\w-]+)/i);
        if (csMatch) {
            const csBoundary = csMatch[1];
            const csParts = trimmed.split('--' + csBoundary);
            const csResponseBoundary = 'changeset_response_' + String(Date.now());

            let csResponseParts = '';
            for (const csPart of csParts) {
                const csTrimmed = csPart.trim();
                if (!csTrimmed || csTrimmed === '--') continue;

                const processed = processBatchPart(csTrimmed, svc);
                if (processed) {
                    csResponseParts += `--${csResponseBoundary}\r\n`;
                    csResponseParts += `Content-Type: application/http\r\nContent-Transfer-Encoding: binary\r\n\r\n`;
                    csResponseParts += `HTTP/1.1 ${processed.status} ${getStatusText(processed.status)}\r\n`;
                    csResponseParts += `Content-Type: ${processed.contentType}\r\n\r\n`;
                    csResponseParts += (typeof processed.body === 'string' ? processed.body : JSON.stringify(processed.body)) + '\r\n';
                }
            }

            if (csResponseParts) {
                responseContent += `--${responseBoundary}\r\n`;
                responseContent += `Content-Type: multipart/mixed; boundary=${csResponseBoundary}\r\n\r\n`;
                responseContent += csResponseParts;
                responseContent += `--${csResponseBoundary}--\r\n`;
            }
        } else {
            // Direct GET request in the batch
            const processed = processBatchPart(trimmed, svc);
            if (processed) {
                responseContent += `--${responseBoundary}\r\n`;
                responseContent += `Content-Type: application/http\r\nContent-Transfer-Encoding: binary\r\n\r\n`;
                responseContent += `HTTP/1.1 ${processed.status} ${getStatusText(processed.status)}\r\n`;
                responseContent += `Content-Type: ${processed.contentType}\r\n\r\n`;
                responseContent += (typeof processed.body === 'string' ? processed.body : JSON.stringify(processed.body)) + '\r\n';
            }
        }
    }

    responseContent += `--${responseBoundary}--\r\n`;
    return res.send(responseContent);
}

// --- Handle all OData service requests ---
app.all('/sap/*', (req, res) => {
    const url = req.path;
    const svc = findService(url);

    if (!svc) {
        return res.status(404).json({ error: { message: 'Service not found for path: ' + url } });
    }

    const relPath = url.substring(svc.prefix.length);

    // If it's a batch request, handle separately
    if (relPath === '/$batch' || relPath === '/$batch/') {
        return handleBatch(req, res, svc);
    }

    // Otherwise, process as a standard OData request
    const result = processODataRequest(req.method, relPath, req.query, req.body, svc);
    res.setHeader('Content-Type', result.contentType);
    if (svc.isV4) {
        res.setHeader('OData-Version', '4.0');
    } else {
        res.setHeader('DataServiceVersion', '2.0');
    }
    return res.status(result.status).send(typeof result.body === 'string' ? result.body : JSON.stringify(result.body));
});

module.exports = app;
