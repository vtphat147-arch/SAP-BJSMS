const express = require('express');
const path = require('path');
const fs = require('fs');
const FEMockserver = require('@sap-ux/fe-mockserver-core').default;

const app = express();

// Set up MockServer with file watching disabled to prevent hanging in Lambda
const mockServer = new FEMockserver({
    watch: false,
    services: [
        {
            urlPath: "/sap/opu/odata4/sap/zui_job_manage01_o4/srvd/sap/z_sd_job_ovp/0001",
            metadataPath: path.join(__dirname, "..", "webapp", "localService", "metadata.xml"),
            mockdataPath: path.join(__dirname, "..", "webapp", "localService", "mockdata")
        },
        {
            urlPath: "/sap/opu/odata/sap/ZUI_JOB_OVP",
            metadataPath: path.join(__dirname, "..", "apps", "dashboard", "webapp", "localService", "mainService", "metadata.xml"),
            mockdataPath: path.join(__dirname, "..", "apps", "dashboard", "webapp", "localService", "mainService", "data")
        },
        {
            urlPath: "/sap/opu/odata/sap/Z_SB_JOB",
            metadataPath: path.join(__dirname, "..", "apps", "analytic", "webapp", "localService", "mainService", "metadata.xml"),
            mockdataPath: path.join(__dirname, "..", "apps", "analytic", "webapp", "localService", "mainService", "data")
        }
    ],
    annotations: [
        {
            urlPath: "/sap/opu/odata/IWFND/CATALOGSERVICE;v=2/Annotations(TechnicalName='ZUI_JOB_OVP_VAN',Version='0001')/$value/",
            localPath: path.join(__dirname, "..", "apps", "dashboard", "webapp", "localService", "mainService", "ZUI_JOB_OVP_VAN.xml")
        },
        {
            urlPath: "/sap/opu/odata/IWFND/CATALOGSERVICE;v=2/Annotations(TechnicalName='Z_SB_JOB_VAN',Version='0001')/$value/",
            localPath: path.join(__dirname, "..", "apps", "analytic", "webapp", "localService", "mainService", "Z_SB_JOB_VAN.xml")
        }
    ]
});

// Race the mock server startup with a 3-second timeout
const TIMEOUT_MS = 3000;
const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
        reject(new Error("FEMockserver failed to initialize within 3s (likely watch/eventloop issue on Serverless)"));
    }, TIMEOUT_MS);
});

let routerPromise = Promise.race([
    mockServer.isReady.then(() => {
        console.log("MockServer is ready");
        return mockServer.getRouter();
    }),
    timeoutPromise
]).catch(err => {
    console.error("MockServer initialization error or timeout:", err.message);
    return null; // Return null so we fall back to manual router
});

// Debug endpoint to check file bundle status
app.get('/sap/debug', (req, res) => {
    const pathsToCheck = {
        metadata: path.join(__dirname, "..", "webapp", "localService", "metadata.xml"),
        mockdata: path.join(__dirname, "..", "webapp", "localService", "mockdata"),
        dashboardMetadata: path.join(__dirname, "..", "apps", "dashboard", "webapp", "localService", "mainService", "metadata.xml"),
        dashboardMockdata: path.join(__dirname, "..", "apps", "dashboard", "webapp", "localService", "mainService", "data"),
        analyticMetadata: path.join(__dirname, "..", "apps", "analytic", "webapp", "localService", "mainService", "metadata.xml"),
        analyticMockdata: path.join(__dirname, "..", "apps", "analytic", "webapp", "localService", "mainService", "data")
    };
    
    const results = {};
    for (const [key, p] of Object.entries(pathsToCheck)) {
        results[key] = {
            path: p,
            exists: fs.existsSync(p),
            isDir: fs.existsSync(p) ? fs.statSync(p).isDirectory() : false
        };
    }
    
    res.json({
        __dirname,
        cwd: process.cwd(),
        results
    });
});

// Fallback router in case FEMockserver hangs or fails on Vercel
function fallbackRouter(req, res) {
    const url = req.path;
    console.log("Fallback router serving path:", url);

    // 1. Metadata XML requests
    if (url.endsWith('/$metadata') || url.endsWith('/$metadata/')) {
        let filePath = "";
        if (url.includes('/zui_job_manage01_o4/')) {
            filePath = path.join(__dirname, "..", "webapp", "localService", "metadata.xml");
        } else if (url.includes('/ZUI_JOB_OVP')) {
            filePath = path.join(__dirname, "..", "apps", "dashboard", "webapp", "localService", "mainService", "metadata.xml");
        } else if (url.includes('/Z_SB_JOB')) {
            filePath = path.join(__dirname, "..", "apps", "analytic", "webapp", "localService", "mainService", "metadata.xml");
        }
        
        if (filePath && fs.existsSync(filePath)) {
            res.setHeader('Content-Type', 'application/xml');
            return res.send(fs.readFileSync(filePath, 'utf8'));
        }
    }

    // 2. Annotation requests
    if (url.includes('/Annotations')) {
        let filePath = "";
        if (url.includes('ZUI_JOB_OVP_VAN')) {
            filePath = path.join(__dirname, "..", "apps", "dashboard", "webapp", "localService", "mainService", "ZUI_JOB_OVP_VAN.xml");
        } else if (url.includes('Z_SB_JOB_VAN')) {
            filePath = path.join(__dirname, "..", "apps", "analytic", "webapp", "localService", "mainService", "Z_SB_JOB_VAN.xml");
        }
        
        if (filePath && fs.existsSync(filePath)) {
            res.setHeader('Content-Type', 'application/xml');
            return res.send(fs.readFileSync(filePath, 'utf8'));
        }
    }

    let dataFolder = "";
    if (url.includes('/zui_job_manage01_o4/')) {
        dataFolder = path.join(__dirname, "..", "webapp", "localService", "mockdata");
    } else if (url.includes('/ZUI_JOB_OVP')) {
        dataFolder = path.join(__dirname, "..", "apps", "dashboard", "webapp", "localService", "mainService", "data");
    } else if (url.includes('/Z_SB_JOB')) {
        dataFolder = path.join(__dirname, "..", "apps", "analytic", "webapp", "localService", "mainService", "data");
    }

    // 3. Batch requests
    if (url.endsWith('/$batch') || url.includes('/$batch/')) {
        let bodyText = "";
        req.on('data', chunk => { bodyText += chunk.toString(); });
        req.on('end', () => {
            console.log("Fallback batch body:", bodyText);
            const isV4 = url.includes('/zui_job_manage01_o4/');
            
            const entities = [
                "JobList", "JobLog", "JobStep", "JobSpool", "Z_I_ProgramVH", "Z_I_VariantVH",
                "JobStatistics", "ActiveJobRuns", "JobExecutionStatus", "TotalJobs", "FailedJobs",
                "JobStatusAnalytics", "JobDurationAnalytics", "JobDelayAnalytics"
            ];
            
            let matchedEntities = [];
            for (const entity of entities) {
                if (bodyText.includes(`/${entity}`) || bodyText.includes(`%2F${entity}`)) {
                    matchedEntities.push(entity);
                }
            }
            
            if (matchedEntities.length > 0 && dataFolder && fs.existsSync(dataFolder)) {
                let responseParts = [];
                for (let i = 0; i < matchedEntities.length; i++) {
                    const entity = matchedEntities[i];
                    const filePath = path.join(dataFolder, `${entity}.json`);
                    let entityJson = isV4 ? { value: [] } : { d: { results: [] } };
                    
                    if (fs.existsSync(filePath)) {
                        try {
                            const rawData = fs.readFileSync(filePath, 'utf8');
                            const json = JSON.parse(rawData);
                            const arrayData = Array.isArray(json) ? json : (json.value || (json.d && json.d.results) || []);
                            entityJson = isV4 ? { value: arrayData } : { d: { results: arrayData } };
                        } catch (e) {
                            console.error("Error reading fallback batch data:", e.message);
                        }
                    }
                    
                    responseParts.push(
                        `--changeset_response\r\n` +
                        `Content-Type: application/http\r\n` +
                        `Content-Transfer-Encoding: binary\r\n\r\n` +
                        `HTTP/1.1 200 OK\r\n` +
                        `Content-Type: application/json\r\n\r\n` +
                        `${JSON.stringify(entityJson)}\r\n`
                    );
                }
                
                const boundary = "batch_response";
                res.setHeader('Content-Type', `multipart/mixed; boundary=${boundary}`);
                
                let body = `--${boundary}\r\n` +
                           `Content-Type: multipart/mixed; boundary=changeset_response\r\n\r\n` +
                           responseParts.join("") +
                           `--changeset_response--\r\n` +
                           `--${boundary}--`;
                
                return res.send(body);
            } else {
                res.setHeader('Content-Type', 'multipart/mixed; boundary=batch_response');
                return res.send('--batch_response\r\nContent-Type: application/http\r\nContent-Transfer-Encoding: binary\r\n\r\nHTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n' + (isV4 ? '{"value":[]}' : '{"d":{"results":[]}}') + '\r\n--batch_response--\r\n');
            }
        });
        return;
    }

    // 4. Entity Set Mock JSON data requests (Direct GETs)
    let matchedEntity = "";
    if (dataFolder && fs.existsSync(dataFolder)) {
        const entities = [
            "JobList", "JobLog", "JobStep", "JobSpool", "Z_I_ProgramVH", "Z_I_VariantVH",
            "JobStatistics", "ActiveJobRuns", "JobExecutionStatus", "TotalJobs", "FailedJobs",
            "JobStatusAnalytics", "JobDurationAnalytics", "JobDelayAnalytics"
        ];
        for (const entity of entities) {
            if (url.includes(`/${entity}`)) {
                matchedEntity = entity;
                break;
            }
        }
        
        if (matchedEntity) {
            const filePath = path.join(dataFolder, `${matchedEntity}.json`);
            if (fs.existsSync(filePath)) {
                res.setHeader('Content-Type', 'application/json');
                const rawData = fs.readFileSync(filePath, 'utf8');
                try {
                    const json = JSON.parse(rawData);
                    const arrayData = Array.isArray(json) ? json : (json.value || (json.d && json.d.results) || []);
                    if (url.includes('/zui_job_manage01_o4/')) {
                        return res.json({ value: arrayData });
                    } else {
                        return res.json({ d: { results: arrayData } });
                    }
                } catch (e) {
                    return res.status(500).json({ error: "Parse error", message: e.message });
                }
            }
        }
    }

    res.status(404).send("Not Found by fallback router: " + url);
}

app.all('*', async (req, res) => {
    try {
        const router = await routerPromise;
        if (router) {
            router(req, res, (err) => {
                if (err) {
                    console.warn("MockServer router error, falling back:", err.message);
                    fallbackRouter(req, res);
                } else {
                    fallbackRouter(req, res);
                }
            });
        } else {
            console.warn("MockServer router not available, falling back to manual router");
            fallbackRouter(req, res);
        }
    } catch (err) {
        console.error("Critical error in request handler:", err);
        fallbackRouter(req, res);
    }
});

module.exports = app;
