const express = require('express');
const path = require('path');
const FEMockserver = require('@sap-ux/fe-mockserver-core').default;

const app = express();

const mockServer = new FEMockserver({
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

let routerPromise = mockServer.isReady.then(() => {
    console.log("MockServer is ready");
    return mockServer.getRouter();
}).catch(err => {
    console.error("MockServer initialization error", err);
    throw err;
});

app.all('*', async (req, res) => {
    try {
        const router = await routerPromise;
        router(req, res, (err) => {
            if (err) {
                res.status(500).send(err.message);
            } else {
                res.status(404).send('Not Found');
            }
        });
    } catch (err) {
        res.status(500).send("Mock OData Services failed to initialize: " + err.message);
    }
});

module.exports = app;
