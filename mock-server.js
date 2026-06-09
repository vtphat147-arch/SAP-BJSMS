const express = require('express');
const path = require('path');
const https = require('https');
const FEMockserver = require('@sap-ux/fe-mockserver-core').default;

const app = express();

const mockServer = new FEMockserver({
    services: [
        {
            urlPath: "/sap/opu/odata4/sap/zui_job_manage01_o4/srvd/sap/z_sd_job_ovp/0001",
            metadataPath: path.join(__dirname, "webapp", "localService", "metadata.xml"),
            mockdataPath: path.join(__dirname, "webapp", "localService", "mockdata")
        },
        {
            urlPath: "/sap/opu/odata/sap/ZUI_JOB_OVP",
            metadataPath: path.join(__dirname, "apps", "dashboard", "webapp", "localService", "mainService", "metadata.xml"),
            mockdataPath: path.join(__dirname, "apps", "dashboard", "webapp", "localService", "mainService", "data")
        },
        {
            urlPath: "/sap/opu/odata/sap/Z_SB_JOB",
            metadataPath: path.join(__dirname, "apps", "analytic", "webapp", "localService", "mainService", "metadata.xml"),
            mockdataPath: path.join(__dirname, "apps", "analytic", "webapp", "localService", "mainService", "data")
        }
    ],
    annotations: [
        {
            urlPath: "/sap/opu/odata/IWFND/CATALOGSERVICE;v=2/Annotations(TechnicalName='ZUI_JOB_OVP_VAN',Version='0001')/$value/",
            localPath: path.join(__dirname, "apps", "dashboard", "webapp", "localService", "mainService", "ZUI_JOB_OVP_VAN.xml")
        },
        {
            urlPath: "/sap/opu/odata/IWFND/CATALOGSERVICE;v=2/Annotations(TechnicalName='Z_SB_JOB_VAN',Version='0001')/$value/",
            localPath: path.join(__dirname, "apps", "analytic", "webapp", "localService", "mainService", "Z_SB_JOB_VAN.xml")
        }
    ]
});

// Once mockServer is ready, mount its router
mockServer.isReady.then(() => {
    console.log("Mock OData Services initialized successfully!");
    
    // Mount the mock server router for OData calls
    app.use(mockServer.getRouter());

    // Proxy UI5 resources to sapui5 CDN
    const agent = new https.Agent({ rejectUnauthorized: false });
    const handleUi5Resources = (req, res) => {
        const url = `https://ui5.sap.com${req.baseUrl}${req.url}`;
        https.get(url, { agent }, (proxyRes) => {
            if (proxyRes.statusCode >= 400) {
                console.warn(`[Proxy Warning] ${req.baseUrl}${req.url} returned status ${proxyRes.statusCode}`);
            }
            res.writeHead(proxyRes.statusCode, proxyRes.headers);
            proxyRes.pipe(res);
        }).on('error', (err) => {
            console.error(`[Proxy Error] Failed to fetch UI5 resource: ${url}`, err);
            res.status(500).send(err.message);
        });
    };
    app.use('/resources', handleUi5Resources);
    app.use('/test-resources', handleUi5Resources);

    // Redirect relative paths for standalone app navigation fallbacks
    app.get([
        '/dashboard/analytic',
        '/dashboard/analytic/',
        '/dashboard/analytic/index.html'
    ], (req, res) => {
        res.redirect('/analytic/index.html');
    });
    app.get([
        '/analytic/dashboard',
        '/analytic/dashboard/',
        '/analytic/dashboard/index.html'
    ], (req, res) => {
        res.redirect('/dashboard/index.html');
    });

    // Static assets (no cache to prevent view/controller caching in development)
    const noCache = (req, res, next) => {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        next();
    };
    app.use('/dashboard', noCache, express.static(path.join(__dirname, 'apps/dashboard/webapp')));
    app.use('/analytic', noCache, express.static(path.join(__dirname, 'apps/analytic/webapp')));
    app.use('/', noCache, express.static(path.join(__dirname, 'webapp')));

    app.listen(8080, () => {
        console.log("==================================================");
        console.log("Mock Server running at http://localhost:8080");
        console.log("Open http://localhost:8080/test/flp.html to view the Fiori Launchpad Sandbox.");
        console.log("==================================================");
    });
}).catch(err => {
    console.error("Failed to initialize Mock OData Services:", err);
});
