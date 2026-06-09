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

// --- Handle all OData service requests ---
app.all('/sap/*', (req, res) => {
    const url = req.path;
    const svc = findService(url);

    if (!svc) {
        return res.status(404).json({ error: { message: 'Service not found for path: ' + url } });
    }

    // The relative path after the service prefix
    const relPath = url.substring(svc.prefix.length);

    // 1. $metadata
    if (relPath === '/$metadata' || relPath === '/$metadata/') {
        const content = readFileIfExists(svc.metadataFile);
        if (content) {
            res.setHeader('Content-Type', 'application/xml;charset=utf-8');
            return res.send(content);
        }
        return res.status(404).send('Metadata not found');
    }

    // 2. Service document (root)
    if (relPath === '' || relPath === '/') {
        if (svc.isV4) {
            return res.json({
                '@odata.context': '$metadata',
                value: [
                    { name: 'JobList', url: 'JobList' },
                    { name: 'Z_I_ProgramVH', url: 'Z_I_ProgramVH' },
                    { name: 'Z_I_VariantVH', url: 'Z_I_VariantVH' }
                ]
            });
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
            res.setHeader('Content-Type', 'application/xml;charset=utf-8');
            return res.send(xml);
        }
    }

    // 3. $batch (OData V4 JSON batch or V2 multipart)
    if (relPath === '/$batch' || relPath === '/$batch/') {
        return handleBatch(req, res, svc);
    }

    // 4. $count
    if (relPath.endsWith('/$count')) {
        const entityName = relPath.replace('/$count', '').replace(/^\//, '').split('(')[0];
        const data = readJsonData(svc.dataDir, entityName);
        res.setHeader('Content-Type', 'text/plain');
        return res.send(String(data.length));
    }

    // 5. Entity set or single entity
    const entityMatch = relPath.match(/^\/([A-Za-z_]\w*)(?:\(([^)]*)\))?/);
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
                const navMatch = relPath.match(/\)\/(_.+)/);
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
                            return res.json(wrapResponse(filtered, svc.isV4));
                        }
                    }
                    return res.json(wrapResponse([], svc.isV4));
                }

                // Check for bound action (POST)
                if (req.method === 'POST') {
                    const actionMatch = relPath.match(/\)\/.*\.(\w+)$/);
                    if (actionMatch) {
                        return handleAction(req, res, svc, actionMatch[1], item, data, keyParts);
                    }
                }

                return res.json(wrapSingle(item, svc.isV4));
            }
            return res.status(404).json({ error: { message: `Entity ${entityName} with key ${keyStr} not found` } });
        }

        // DELETE single entity
        if (req.method === 'DELETE') {
            return res.status(204).send();
        }

        // Collection with $filter, $top, $skip, $orderby, $select
        let result = [...data];
        const query = req.query;

        if (query.$filter) {
            // Simple filter: field eq 'value'
            const filters = query.$filter.match(/(\w+)\s+eq\s+'([^']*)'/g) || [];
            for (const f of filters) {
                const m = f.match(/(\w+)\s+eq\s+'([^']*)'/);
                if (m) result = result.filter(d => String(d[m[1]]) === m[2]);
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

        const response = wrapResponse(result, svc.isV4);
        if (query.$count === 'true' || query.$inlinecount === 'allpages') {
            if (svc.isV4) response['@odata.count'] = totalCount;
            else response.d.__count = String(totalCount);
        }
        return res.json(response);
    }

    // Unbound action (POST to service root)
    if (req.method === 'POST') {
        const actionMatch = relPath.match(/^\/.*\.(\w+)$/);
        if (actionMatch) {
            const entityData = readJsonData(svc.dataDir, 'JobList');
            return handleAction(req, res, svc, actionMatch[1], null, entityData, {});
        }
    }

    res.status(404).json({ error: { message: 'Not found: ' + url } });
});

// --- Batch handler ---
function handleBatch(req, res, svc) {
    // For OData V4 JSON batch
    if (svc.isV4) {
        let body = {};
        try {
            body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
        } catch (e) { body = {}; }

        const requests = body.requests || [];
        const responses = requests.map((r, i) => {
            const rUrl = r.url || '';
            const entityMatch = rUrl.match(/^([A-Za-z_]\w*)(?:\(([^)]*)\))?/);
            if (entityMatch) {
                const entityName = entityMatch[0].split('(')[0];
                const data = readJsonData(svc.dataDir, entityName);
                return { id: r.id || String(i), status: 200, body: { value: data } };
            }
            return { id: r.id || String(i), status: 200, body: { value: [] } };
        });

        return res.json({ responses });
    }

    // For OData V2 multipart batch — return empty results
    const boundary = 'batch_response_' + Date.now();
    res.setHeader('Content-Type', `multipart/mixed; boundary=${boundary}`);

    // Parse body text to find entity names
    const bodyText = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || '');
    const entityNames = new Set();
    if (fs.existsSync(svc.dataDir)) {
        for (const f of fs.readdirSync(svc.dataDir)) {
            const name = f.replace('.json', '');
            if (bodyText.includes(name)) entityNames.add(name);
        }
    }

    let parts = '';
    const changeBoundary = 'changeset_' + Date.now();

    for (const entity of entityNames) {
        const data = readJsonData(svc.dataDir, entity);
        parts += `--${changeBoundary}\r\n`;
        parts += `Content-Type: application/http\r\nContent-Transfer-Encoding: binary\r\n\r\n`;
        parts += `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n`;
        parts += JSON.stringify({ d: { results: data } }) + '\r\n';
    }

    if (!parts) {
        parts += `--${changeBoundary}\r\n`;
        parts += `Content-Type: application/http\r\nContent-Transfer-Encoding: binary\r\n\r\n`;
        parts += `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n`;
        parts += `{"d":{"results":[]}}\r\n`;
    }

    const responseBody =
        `--${boundary}\r\n` +
        `Content-Type: multipart/mixed; boundary=${changeBoundary}\r\n\r\n` +
        parts +
        `--${changeBoundary}--\r\n` +
        `--${boundary}--\r\n`;

    return res.send(responseBody);
}

// --- Action handler ---
function handleAction(req, res, svc, actionName, entity, allData, keys) {
    const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch(e) { return {}; } })() : (req.body || {});

    switch (actionName) {
        case 'StopJob': {
            if (entity) {
                entity.StatusText = 'Aborted';
                entity.Criticality = 1;
                entity.EndDate = new Date().toISOString().split('T')[0];
            }
            return res.json(wrapSingle(entity || {}, svc.isV4));
        }
        case 'DeleteJob': {
            return res.status(204).send();
        }
        case 'ReleaseJob': {
            if (entity) {
                const isImmediate = body.IsImmediate === true || body.IsImmediate === 'X';
                entity.StatusText = isImmediate ? 'Active' : 'Scheduled';
                entity.Criticality = isImmediate ? 3 : 2;
            }
            return res.json(wrapSingle(entity || {}, svc.isV4));
        }
        case 'RepeatWithSchedule': {
            const newJob = { ...(entity || {}), JobCount: String(Date.now()).slice(-6) };
            return res.json(wrapSingle(newJob, svc.isV4));
        }
        case 'CopyJob': {
            const newJob = {
                ...(entity || {}),
                JobName: body.NewJobName || 'Copy_' + (entity && entity.JobName),
                JobCount: String(Date.now()).slice(-6),
                StatusText: 'Scheduled',
                Criticality: 2
            };
            return res.json(wrapSingle(newJob, svc.isV4));
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
            return res.json(wrapSingle(newJob, svc.isV4));
        }
        default:
            return res.json(wrapSingle(entity || {}, svc.isV4));
    }
}

module.exports = app;
