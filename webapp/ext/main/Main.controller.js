sap.ui.define(
    [
        'sap/fe/core/PageController',
        "sap/m/MessageToast",
        "sap/m/MessageBox",
        "sap/ui/model/Filter",
        "sap/ui/model/FilterOperator",
        "sap/ui/core/Fragment",
        "sap/ui/core/BusyIndicator",
        "sap/ui/model/json/JSONModel"
    ],
    function (PageController, MessageToast, MessageBox, Filter, FilterOperator, Fragment, BusyIndicator, JSONModel) {
        'use strict';

        return PageController.extend('project5.ext.main.Main', {

            onInit: function () {
                if (PageController.prototype.onInit) {
                    PageController.prototype.onInit.apply(this, arguments);
                }
                var oRouter = this.getOwnerComponent().getRouter();
                if (oRouter) {
                    var oRoute = oRouter.getRoute("JobListMain");
                    if (oRoute) {
                        oRoute.attachPatternMatched(this._onRouteMatched, this);
                    }
                }
            },

            _onRouteMatched: function () {
                this._refreshTable();
            },

            // ==================== REFRESH ====================
            onRefreshTable: function () {
                this._refreshTable();
            },

            // ==================== HELPER: Robust selection retrieval ====================
            _getSelectedContexts: function () {
                var oTable = this.byId("Table");
                if (!oTable) return [];
                
                // 1. Try direct Macro API
                if (typeof oTable.getSelectedContexts === "function") {
                    try {
                        var aContexts = oTable.getSelectedContexts();
                        if (aContexts && aContexts.length > 0) return aContexts;
                    } catch (e) {
                        console.warn("Macro getSelectedContexts failed", e);
                    }
                }
                
                // 2. Try inner Table content API
                if (typeof oTable.getContent === "function") {
                    var oContent = oTable.getContent();
                    if (oContent && typeof oContent.getSelectedContexts === "function") {
                        try {
                            var aContexts = oContent.getSelectedContexts();
                            if (aContexts && aContexts.length > 0) return aContexts;
                        } catch (e) {
                            console.warn("Inner content getSelectedContexts failed", e);
                        }
                    }
                }

                // 3. Try ExtensionAPI
                var oExtensionAPI = this.getExtensionAPI();
                if (oExtensionAPI && typeof oExtensionAPI.getSelectedContexts === "function") {
                    try {
                        return oExtensionAPI.getSelectedContexts(oTable) || [];
                    } catch (e) {
                        console.warn("ExtensionAPI getSelectedContexts failed", e);
                    }
                }

                return [];
            },

            // ==================== MANAGE MENU ====================
            onOpenManageMenu: function (oEvent) {
                var oButton = oEvent.getSource();
                var oActionSheet = this.byId("manageActionSheet");

                // Get selected contexts to dynamically enable/disable actions
                var aSelected = this._getSelectedContexts();
                var iSelectedCount = aSelected.length;

                // Nút Copy chỉ Enable khi user chọn ĐÚNG 1 dòng + UX Feedback
                var oCopyBtn = this.byId("idCopyButton");
                if (oCopyBtn) {
                    var bIsCopyEnabled = (iSelectedCount === 1);
                    oCopyBtn.setEnabled(bIsCopyEnabled);

                    if (bIsCopyEnabled) {
                        oCopyBtn.setText(" Copy");
                        oCopyBtn.setTooltip("Copy selected job");
                    } else {
                        oCopyBtn.setText(" Copy (Select 1 Job)");
                        oCopyBtn.setTooltip("Please select exactly ONE job to enable copying.");
                    }
                }

                oActionSheet.openBy(oButton);
            },

            // ==================== RELEASE JOB ====================
            onReleaseJob: function () {
                var aSelectedContexts = this._getSelectedContexts();

                if (aSelectedContexts.length === 0) {
                    MessageToast.show("Please select a job.");
                    return;
                }

                this._openActionDialog(
                    "com.sap.gateway.srvd.z_sd_job_ovp.v0001.ReleaseJob",
                    "Define Start Condition"
                );
            },

            // ==================== HELPER: Open Action Dialog ====================
            _openActionDialog: function (sActionName, sTitle) {
                var aSelectedContexts = this._getSelectedContexts();

                if (aSelectedContexts.length === 0) {
                    MessageToast.show("Please select a job.");
                    return;
                }

                // Lưu Action Name hiện tại để sử dụng trong onConfirmRelease
                this._sCurrentAction = sActionName;
                // Lưu Selected Contexts
                this._selectedContexts = aSelectedContexts;

                if (this._pReleaseDialog) {
                    this._pReleaseDialog.then(function (oDialog) {
                        oDialog.setTitle(sTitle);
                        this._resetReleaseDialog();
                        if (!oDialog.isOpen()) {
                            oDialog.open();
                        }
                    }.bind(this));
                    return;
                }

                this._pReleaseDialog = Fragment.load({
                    id: this.getView().getId(),
                    name: "project5.ext.fragment.ReleaseDialog",
                    controller: this
                }).then(function (oDialog) {
                    this.getView().addDependent(oDialog);
                    oDialog.setTitle(sTitle);
                    this._resetReleaseDialog();
                    oDialog.open();
                    return oDialog;
                }.bind(this));
            },

            _resetReleaseDialog: function () {
                var oModel = this.getView().getModel("localRelease");
                if (!oModel) {
                    oModel = new sap.ui.model.json.JSONModel({
                        isImmediate: true,
                        recurrence: "Single Run",
                        frequency: 1
                    });
                    this.getView().setModel(oModel, "localRelease");
                } else {
                    oModel.setProperty("/isImmediate", true);
                    oModel.setProperty("/recurrence", "Single Run");
                    oModel.setProperty("/frequency", 1);
                }

                var oDateTime = this.byId("idReleaseDateTime");
                if (oDateTime) { oDateTime.setDateValue(null); oDateTime.setValue(""); oDateTime.setValueState("None"); }

                var oFreqInput = this.byId("idFrequencyInput");
                if (oFreqInput) { oFreqInput.setValueState("None"); }

                var oTabBar = this.byId("idStartModeTabs");
                if (oTabBar) { oTabBar.setSelectedKey("immediate"); }
            },

            onImmediateChange: function (oEvent) {
                var bSelected = oEvent.getParameter("selected");
                var oModel = this.getView().getModel("localRelease");
                if (oModel) {
                    oModel.setProperty("/isImmediate", bSelected);
                }

                // Clear errors on target change
                if (bSelected) {
                    var oDateTime = this.byId("idReleaseDateTime");
                    if (oDateTime) {
                        oDateTime.setValueState("None");
                    }
                }
            },

            onFrequencyChange: function (oEvent) {
                var oInput = oEvent.getSource();
                var sValue = oInput.getValue().trim();

                // Trường hợp trống hoặc <= 0
                if (!sValue || parseInt(sValue, 10) <= 0) {
                    oInput.setValueState("Error");
                    oInput.setValueStateText("Frequency value must be greater than 0");
                }
                // Có chứa ký tự chữ cái, đặc biệt hoặc định dạng số thập phân, số âm...
                else if (!/^[1-9]\d*$/.test(sValue)) {
                    oInput.setValueState("Error");
                    oInput.setValueStateText("Invalid range for selected recurrence pattern");
                }
                else {
                    oInput.setValueState("None");

                    // Cập nhật lại giá trị chuẩn vào model
                    var oBinding = oInput.getBinding("value");
                    if (oBinding) {
                        oBinding.getModel().setProperty(oBinding.getPath(), sValue);
                    }
                }
            },

            onReleaseDateTimeChange: function (oEvent) {
                var oControl = oEvent.getSource();
                if (oControl.getDateValue()) {
                    oControl.setValueState("None");
                }
            },

            onConfirmRelease: async function () {
                var that = this;

                if (this._bConfirmInFlight) {
                    return;
                }
                this._bConfirmInFlight = true;

                var aSelectedContexts = this._selectedContexts || [];

                if (!aSelectedContexts.length) {
                    MessageToast.show("Please select a job.");
                    this._bConfirmInFlight = false;
                    return;
                }

                // --- 1. LẤY GIÁ TRỊ THÔ TỪ UI ---
                var bIsImmediate = this.byId("idImmedCheck") ? this.byId("idImmedCheck").getSelected() : false;
                var oDateTimeControl = this.byId("idReleaseDateTime");

                // --- 2. ĐỊNH DẠNG CHO CHUẨN ODATA V4 VÀ ĐỔI MÚI GIỜ (GIỐNG CREATE JOB) ---
                var sSapDate = "";
                var sSapTime = "";
                var oDate = null;

                if (bIsImmediate) {
                    oDate = new Date(); // Lấy giờ hiện tại 
                } else if (oDateTimeControl && oDateTimeControl.getDateValue()) {
                    oDate = oDateTimeControl.getDateValue();
                }

                if (oDate && !isNaN(oDate.getTime())) {
                    // Convert local time → SAP server time (Europe/Berlin)
                    var oFormatter = new Intl.DateTimeFormat('en-CA', {
                        timeZone: 'Europe/Berlin',
                        year: 'numeric', month: '2-digit', day: '2-digit',
                        hour: '2-digit', minute: '2-digit', second: '2-digit',
                        hour12: false
                    });
                    var aParts = oFormatter.formatToParts(oDate);
                    var oParts = {};
                    aParts.forEach(function (p) { oParts[p.type] = p.value; });

                    sSapDate = oParts.year + "-" + oParts.month + "-" + oParts.day;
                    sSapTime = oParts.hour + ":" + oParts.minute + ":" + oParts.second;
                }

                // --- 4. VALIDATE: Frequency & DateTime ---
                var oLocalData = this.getView().getModel("localRelease").getData();

                // a. Nếu chọn lặp lại mà để tần suất trống, báo lỗi
                if (oLocalData.recurrence !== "Single Run") {
                    var sFreqValStr = String(oLocalData.frequency || "").trim();
                    var oFreqInput = this.byId("idFrequencyInput");

                    if (!sFreqValStr || parseInt(sFreqValStr, 10) <= 0) {
                        if (oFreqInput) {
                            oFreqInput.setValueState("Error");
                            oFreqInput.setValueStateText("Frequency value must be greater than 0");
                        }
                        this._bConfirmInFlight = false;
                        return;
                    } else if (!/^[1-9]\d*$/.test(sFreqValStr)) {
                        if (oFreqInput) {
                            oFreqInput.setValueState("Error");
                            oFreqInput.setValueStateText("Invalid range for selected recurrence pattern");
                        }
                        this._bConfirmInFlight = false;
                        return;
                    }
                }

                // b. Nếu không phải Immediate thì phải có Date và Time
                if (!bIsImmediate) {
                    if (!oDate) {
                        if (oDateTimeControl) {
                            oDateTimeControl.setValueState("Error");
                            oDateTimeControl.setValueStateText("Please enter start date and time.");
                        }
                        this._bConfirmInFlight = false;
                        return;
                    }

                    // Validate that the scheduled date/time is not in the past (allow 1 minute tolerance)
                    if (oDate) {
                        var oNow = new Date();
                        oNow.setMinutes(oNow.getMinutes() - 1);
                        if (oDate < oNow) {
                            if (oDateTimeControl) {
                                oDateTimeControl.setValueState("Error");
                                oDateTimeControl.setValueStateText("Start time must be in the future");
                            }
                            MessageBox.error("Start time must be in the future");
                            this._bConfirmInFlight = false;
                            return;
                        }
                    }
                }

                // --- 5. LẤY THÔNG TIN FREQUENCY TỪ MODEL ---
                var oLocalData = this.getView().getModel("localRelease").getData();
                var mFreqMap = { "Minutes": "MINUTES", "Hourly": "HOURLY", "Daily": "DAILY", "Weekly": "WEEKLY", "Monthly": "MONTHLY" };
                var sFreqType = mFreqMap[oLocalData.recurrence] || "";
                var iFreqValue = sFreqType ? Math.max(1, parseInt(oLocalData.frequency, 10) || 1) : 0;

                var aParameterValues = [
                    { name: "IsImmediate", value: bIsImmediate },
                    { name: "StartDate", value: sSapDate },
                    { name: "StartTime", value: sSapTime },
                    { name: "FrequencyType", value: sFreqType },
                    { name: "FrequencyValue", value: iFreqValue },
                    { name: "AfterJobName", value: this.byId("idAfterJobName") ? this.byId("idAfterJobName").getValue() : "" },
                    { name: "EventID", value: this.byId("idEventID") ? this.byId("idEventID").getValue() : "" },
                    { name: "EventParam", value: this.byId("idEventParam") ? this.byId("idEventParam").getValue() : "" }
                ];

                // Clear old messages before action
                var oMessageManager = sap.ui.getCore().getMessageManager();
                oMessageManager.removeAllMessages();

                BusyIndicator.show(0);

                var sCurrentAction = this._sCurrentAction || "com.sap.gateway.srvd.z_sd_job_ovp.v0001.ReleaseJob";
                var sActionLabel = (sCurrentAction.indexOf("Repeat") !== -1) ? "Repeat Job" : "Release Job";
                var aFailedMessages = [];

                // Execute action directly via OData V4 Model to capture exact execution errors
                try {
                    for (var oContext of aSelectedContexts) {
                        var oActionContext = oContext.getModel().bindContext(sCurrentAction + "(...)", oContext);

                        // Set parameters
                        aParameterValues.forEach(function (oParam) {
                            oActionContext.setParameter(oParam.name, oParam.value);
                        });

                        try {
                            await oActionContext.execute();
                        } catch (oError) {
                            var sErr = oError?.error?.message || oError?.message || "Unknown error";
                            aFailedMessages.push(sErr);
                        }
                    }
                } catch (e) {
                    aFailedMessages.push(e.message || "Execution exception");
                }

                BusyIndicator.hide();
                that._bConfirmInFlight = false;

                var bIsSuccess = that._handleActionMessages(sActionLabel + " completed successfully.", aFailedMessages);

                that.onCloseReleaseDialog();
                that._refreshTable();
            },

            onCloseReleaseDialog: function () {
                if (!this._pReleaseDialog) {
                    return;
                }

                this._pReleaseDialog.then(function (oDialog) {
                    if (oDialog && oDialog.isOpen()) {
                        oDialog.close();
                    }
                }.bind(this));
            },

            // ==================== HELPER: Handle Action Response Messages ====================
            _handleActionMessages: function (sFallbackSuccessMessage, aFallbackErrors) {
                var oMessageManager = sap.ui.getCore().getMessageManager();
                var aMessages = oMessageManager.getMessageModel().getData() || [];

                var aErrorMessages = (aFallbackErrors || []).slice(); // Add fallback errors from catch blocks
                var aWarningMessages = [];
                var aSuccessMessages = [];

                // Categorize messages correctly by using lowerCase to avoid undefined enum dependencies
                aMessages.forEach(function (oMsg) {
                    var sType = (oMsg && oMsg.type ? oMsg.type : "").toLowerCase();
                    var sMessage = oMsg.message || "Unknown error occurred";

                    // Prevent duplicate errors if the MessageManager already caught the same error
                    if (sType === "error" && !aErrorMessages.includes(sMessage)) {
                        aErrorMessages.push(sMessage);
                    } else if (sType === "warning") {
                        aWarningMessages.push(sMessage);
                    } else if (sType === "success") {
                        aSuccessMessages.push(sMessage);
                    }
                });

                // 1. FULL FAILURE: If only errors occurred (or errors + warnings but no success)
                if (aErrorMessages.length > 0 && aSuccessMessages.length === 0) {
                    // Extract unique error messages to avoid long repeating popups
                    var aUniqueErrors = [...new Set(aErrorMessages)];
                    MessageBox.error(aUniqueErrors.join("\n\n"));
                    return false; // Indicate failure
                }

                // 2. PARTIAL SUCCESS: Both Success and Errors exist
                if (aErrorMessages.length > 0 && aSuccessMessages.length > 0) {
                    var aUniqueErrors = [...new Set(aErrorMessages)];
                    var aUniqueSuccess = [...new Set(aSuccessMessages)];
                    var sPartialMsg = "Warning: Some operations failed.\n\n" +
                        "Errors:\n" + aUniqueErrors.map(function (m) { return "• " + m; }).join("\n") + "\n\n" +
                        "Successes:\n" + aUniqueSuccess.map(function (m) { return "• " + m; }).join("\n");
                    MessageBox.warning(sPartialMsg);
                    return true;
                }

                // 3. FULL SUCCESS
                if (aSuccessMessages.length > 0) {
                    var aUniqueSuccess = [...new Set(aSuccessMessages)];
                    MessageToast.show(aUniqueSuccess.join("\n"));
                } else {
                    MessageToast.show(sFallbackSuccessMessage);
                }

                return true;
            },

            // ==================== HELPER: Gọi Bound Action cho nhiều dòng ====================
            _executeAction: async function (aContexts, sActionName, sLabel) {
                console.log(`_executeAction called for label: ${sLabel}, action: ${sActionName}, targets count: ${aContexts.length}`);
                sap.ui.getCore().getMessageManager().removeAllMessages();

                const results = await Promise.allSettled(
                    aContexts.map(ctx => {
                        console.log(`Executing bound action on context: ${ctx.getPath()}`);
                        return ctx.getModel().bindContext(sActionName + "(...)", ctx).execute("$direct");
                    })
                );

                const aFailed = [];
                results.forEach((r, i) => {
                    if (r.status !== "fulfilled") {
                        const sName = aContexts[i].getProperty("JobName") || "(unknown)";
                        const sErrorDetail = r.reason?.error?.message || r.reason?.message || "Unknown error";
                        console.error(`Action failed for job ${sName}:`, r.reason);
                        aFailed.push(`• ${sName}: ${sErrorDetail}`);
                    } else {
                        console.log(`Action succeeded for context index ${i}`);
                    }
                });

                // Read success messages from BE (via MessageManager, e.g. msg 012/015 from ZCM_BC_BJSMS_MSG)
                const aAllMsgs = sap.ui.getCore().getMessageManager().getMessageModel().getData();
                const aSuccessMsgs = aAllMsgs.filter(m => m.type === "Success").map(m => m.message);

                if (aSuccessMsgs.length) {
                    MessageToast.show(aSuccessMsgs.join(" | "));
                } else if (!aFailed.length) {
                    MessageToast.show(sLabel + " completed.");
                }
                if (aFailed.length) MessageBox.error(aFailed.join("\n"));

                this._refreshTable();
            },

            // ==================== REPEAT JOB ====================
            onRepeatJob: function () {
                var aSelectedContexts = this._getSelectedContexts();

                if (aSelectedContexts.length === 0) {
                    MessageToast.show("Please select at least one job to repeat.");
                    return;
                }

                this._openActionDialog(
                    "com.sap.gateway.srvd.z_sd_job_ovp.v0001.RepeatWithSchedule",
                    "Define Start Condition for Repeat Job"
                );
            },

            // ==================== COPY & RENAME JOB ====================
            onCopyWithRename: function () {
                var aSelectedContexts = this._getSelectedContexts();

                if (aSelectedContexts.length === 0) {
                    MessageToast.show("Please select at least one job to copy.");
                    return;
                }

                var oSelectedContext = aSelectedContexts[0];
                var sOldJobName = oSelectedContext.getProperty("JobName") || "";
                this._oCopySourceContext = oSelectedContext;

                var that = this;

                if (aSelectedContexts.length > 1) {
                    MessageBox.warning(
                        "You have selected multiple jobs. Only the first selected job (" + sOldJobName + ") will be copied.\n\nDo you want to continue?",
                        {
                            title: "Multiple Jobs Selected",
                            actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
                            onClose: function (sAction) {
                                if (sAction === MessageBox.Action.OK) {
                                    that._openCopyDialog(sOldJobName);
                                }
                            }
                        }
                    );
                    return;
                }

                this._openCopyDialog(sOldJobName);
            },

            _openCopyDialog: function (sOldJobName) {
                var oView = this.getView();
                var oCopyModel = oView.getModel("copyJob");

                if (!oCopyModel) {
                    oCopyModel = new JSONModel({
                        oldJobName: "",
                        newJobName: ""
                    });
                    oView.setModel(oCopyModel, "copyJob");
                }

                oCopyModel.setData({
                    oldJobName: sOldJobName,
                    newJobName: sOldJobName
                });

                if (this._pCopyDialog) {
                    this._pCopyDialog.then(function (oDialog) {
                        oDialog.open();
                        this._syncCopyDialogState();
                    }.bind(this));
                    return;
                }

                this._pCopyDialog = Fragment.load({
                    id: oView.getId(),
                    name: "project5.ext.fragment.CopyJobDialog",
                    controller: this
                }).then(function (oDialog) {
                    oView.addDependent(oDialog);
                    oDialog.open();
                    this._syncCopyDialogState();
                    return oDialog;
                }.bind(this));
            },

            _syncCopyDialogState: function () {
                var oInput = this.byId("copyJobNameInput");
                var oDialog = this.byId("copyJobDialog");
                var sValue = oInput ? oInput.getValue() : "";

                var bValid = true;
                var sErrorMsg = "";

                if (!sValue || sValue.trim() === "") {
                    bValid = false;
                    sErrorMsg = "Job name is required.";
                }

                if (oInput) {
                    oInput.setValueState(bValid ? "None" : "Error");
                    oInput.setValueStateText(sErrorMsg);
                }

                if (oDialog && oDialog.getBeginButton()) {
                    oDialog.getBeginButton().setEnabled(bValid);
                }
            },

            onCopyJobNameLiveChange: function () {
                this._syncCopyDialogState();
            },

            onConfirmCopyJob: async function () {
                var oInput = this.byId("copyJobNameInput");
                var sNewJobName = oInput ? (oInput.getValue() || "").trim() : "";
                var oContext = this._oCopySourceContext;

                if (!sNewJobName) {
                    this._syncCopyDialogState();
                    return;
                }

                if (!oContext) {
                    MessageBox.error("Cannot find the selected job context.");
                    return;
                }

                var that = this;
                var sActionName = "com.sap.gateway.srvd.z_sd_job_ovp.v0001.CopyJob";

                // Clear old messages before action
                var oMessageManager = sap.ui.getCore().getMessageManager();
                oMessageManager.removeAllMessages();

                BusyIndicator.show(0);

                var aFailedMessages = [];

                try {
                    // Try executing native OData V4 Action
                    var oActionContext = oContext.getModel().bindContext(sActionName + "(...)", oContext);
                    oActionContext.setParameter("NewJobName", sNewJobName);

                    await oActionContext.execute();
                } catch (oError) {
                    // HTTP 400 Bad Request execution error will be caught here correctly
                    var sErr = oError?.error?.message || oError?.message || "Unknown error";
                    // Avoid catching user-cancellations (if any)
                    if (sErr.indexOf("cancelled") === -1) {
                        aFailedMessages.push(sErr);
                    }
                }

                BusyIndicator.hide();

                var bIsSuccess = that._handleActionMessages("Copy and Rename completed successfully.", aFailedMessages);

                that.onCloseCopyDialog();
                if (bIsSuccess) {
                    that._clearStartDateFilter();
                }
                that._refreshTable();
            },

            onCloseCopyDialog: function () {
                if (!this._pCopyDialog) {
                    return;
                }

                this._pCopyDialog.then(function (oDialog) {
                    if (oDialog && oDialog.isOpen()) {
                        oDialog.close();
                    }
                });
            },

            _clearStartDateFilter: function () {
                var oMacroFilterBar = this.byId("FilterBar");
                if (!oMacroFilterBar || typeof oMacroFilterBar.getContent !== "function") {
                    return false;
                }

                var oFilterBar = oMacroFilterBar.getContent();
                if (!oFilterBar) {
                    return false;
                }

                var bChanged = false;

                // sap.ui.mdc.FilterBar API
                if (typeof oFilterBar.getFilterConditions === "function" && typeof oFilterBar.setFilterConditions === "function") {
                    var mConditions = oFilterBar.getFilterConditions() || {};
                    if (mConditions.StartDate && mConditions.StartDate.length) {
                        var mUpdatedConditions = Object.assign({}, mConditions);
                        delete mUpdatedConditions.StartDate;
                        oFilterBar.setFilterConditions(mUpdatedConditions);
                        bChanged = true;
                    }
                }

                // Fallback cho ConditionModel
                if (!bChanged && typeof oFilterBar.getConditionModel === "function") {
                    var oConditionModel = oFilterBar.getConditionModel();
                    if (
                        oConditionModel &&
                        typeof oConditionModel.getConditions === "function" &&
                        typeof oConditionModel.removeAllConditions === "function"
                    ) {
                        var aStartDateConditions = oConditionModel.getConditions("StartDate");
                        if (aStartDateConditions && aStartDateConditions.length) {
                            oConditionModel.removeAllConditions("StartDate");
                            bChanged = true;
                        }
                    }
                }

                return bChanged;
            },

            _refreshTable: function () {
                console.log("Refreshing table...");
                var oTable = this.byId("Table");
                if (oTable) {
                    // 1. Try calling refresh directly on the Table Macro (standard Fiori Elements V4)
                    if (typeof oTable.refresh === "function") {
                        try {
                            oTable.refresh();
                            console.log("Table macro refresh called.");
                            return;
                        } catch (e) {
                            console.error("Table macro refresh failed:", e);
                        }
                    }
                    var oContent = oTable.getContent();
                    if (oContent) {
                        if (typeof oContent.refresh === "function") {
                            try {
                                oContent.refresh();
                                console.log("Table content refresh called.");
                                return;
                            } catch (e) {
                                console.error("Table content refresh failed:", e);
                            }
                        }
                        var oBinding = typeof oContent.getRowBinding === "function" ? oContent.getRowBinding() : null;
                        if (!oBinding) {
                            oBinding = oContent.getBinding("rows") || oContent.getBinding("items");
                        }
                        if (oBinding && typeof oBinding.refresh === "function") {
                            try {
                                oBinding.refresh();
                                console.log("Table binding refresh called.");
                                return;
                            } catch (e) {
                                console.error("Table binding refresh failed:", e);
                            }
                        }
                    }
                }
                
                var oExtensionAPI = this.getExtensionAPI();
                if (oExtensionAPI && typeof oExtensionAPI.refresh === "function") {
                    try {
                        oExtensionAPI.refresh();
                        console.log("ExtensionAPI refresh called.");
                    } catch (e) {
                        console.error("ExtensionAPI refresh failed:", e);
                    }
                }
            },

            // ==================== STOP JOB (với Confirmation) ====================
            onStopJob: function () {
                var aSelectedContexts = this._getSelectedContexts();

                if (aSelectedContexts.length === 0) {
                    MessageToast.show("Please select at least one job to stop.");
                    return;
                }

                var iCount = aSelectedContexts.length;
                var sMessage = "Do you want to stop " + iCount + " selected job(s)?";

                var that = this;
                MessageBox.confirm(sMessage, {
                    title: "Confirm Stop Job",
                    onClose: function (sAction) {
                        if (sAction === MessageBox.Action.OK) {
                            that._executeAction(aSelectedContexts, "com.sap.gateway.srvd.z_sd_job_ovp.v0001.StopJob", "Stop");
                        }
                    }
                });
            },

            // ==================== DELETE JOB (với Confirmation) ====================
            onDeleteJob: function () {
                var aSelectedContexts = this._getSelectedContexts();
                if (aSelectedContexts.length === 0) {
                    MessageToast.show("Please select at least one job to delete.");
                    return;
                }

                var iCount = aSelectedContexts.length;
                var sMessage = "Do you want to delete " + iCount + " selected job(s)?";

                var that = this;
                MessageBox.confirm(sMessage, {
                    title: "Confirm Delete Job",
                    onClose: async function (sAction) {
                        if (sAction === MessageBox.Action.OK) {
                            BusyIndicator.show(0);
                            var aFailed = [];
                            for (var oContext of aSelectedContexts) {
                                try {
                                    // Use standard OData V4 context delete to remove the row smoothly without full reload
                                    await oContext.delete();
                                } catch (oError) {
                                    var sName = oContext.getProperty("JobName") || "(unknown)";
                                    var sErr = oError?.message || "Delete failed";
                                    aFailed.push(`• ${sName}: ${sErr}`);
                                }
                            }
                            BusyIndicator.hide();
                            if (aFailed.length > 0) {
                                MessageBox.error("Failed to delete some job(s):\n" + aFailed.join("\n"));
                            } else {
                                MessageToast.show("Job(s) deleted successfully.");
                            }
                            that._refreshTable();
                        }
                    }
                });
            },


            onCreateJob: function (oEvent) {

                var oExtensionAPI = this.getExtensionAPI();

                if (oExtensionAPI && oExtensionAPI.routing) {
                    oExtensionAPI.routing.navigateToRoute("CreateJobRoute");
                } else {
                    console.error("ExtensionAPI routing is not available.");
                }
            },

            onFilterOwnJobs: function () {
                var sCurrentUser;
                if (sap.ushell && sap.ushell.Container) {
                    sCurrentUser = sap.ushell.Container.getService("UserInfo").getId();
                }
                if (!sCurrentUser) {
                    MessageToast.show("Can't get current user.");
                    return;
                }

                var oFilterBar = this.byId("FilterBar").getContent();
                var mConditions = oFilterBar.getFilterConditions() || {};

                // Đảo trạng thái: đang bật thành tắt, đang tắt thành bật
                this._bIsMyJobsFiltered = !this._bIsMyJobsFiltered;

                if (this._bIsMyJobsFiltered) {
                    // Bật: Đặt filter CreatedBy = tên user
                    mConditions.CreatedBy = [{ operator: "EQ", values: [sCurrentUser] }];
                    MessageToast.show("Filtered by user: " + sCurrentUser);
                } else {
                    // Tắt: Xóa filter CreatedBy để hiện tất cả
                    delete mConditions.CreatedBy;
                    MessageToast.show("Showing all jobs");
                }

                oFilterBar.setFilterConditions(mConditions);
                oFilterBar.triggerSearch();
            },
            // --- THÊM HÀM NÀY ĐỂ ĐIỀU HƯỚNG SANG TRANG DETAIL (GIỐNG SM37) ---
            onRowPress: function (oEvent) {
                var oContext = oEvent.getParameters().bindingContext || oEvent.getSource().getBindingContext();
                if (!oContext) {
                    return;
                }

                var oExtensionAPI = this.getExtensionAPI();
                if (oExtensionAPI && oExtensionAPI.routing) {

                    // 1. Lấy đường dẫn Context (Path)
                    // Ví dụ sPath: "/JobList(JobName='BJSM_TEST',JobCount='000001')"
                    var sPath = oContext.getPath();

                    // 2. Tách lấy phần Key nằm trong ngoặc đơn
                    var sKey = sPath.substring(sPath.indexOf("(") + 1, sPath.indexOf(")"));

                    // 3. Điều hướng sang Object Page đã khai báo trong manifest.json
                    // Tên route "JobListObjectPage" và biến "JobListKey" phải khớp với manifest
                    oExtensionAPI.routing.navigateToRoute("JobListObjectPage", {
                        "JobListKey": sKey
                    });
                }
            },

            // ==================== OPEN ANALYTICS MENU ====================
            onOpenAnalyticsMenu: function (e) { this.byId("analyticsActionSheet").openBy(e.getSource()); },
            onOpenDashboard: function () {
                // Navigate within Fiori Launchpad Sandbox instantly
                var oCrossAppNav = sap.ushell && sap.ushell.Container && sap.ushell.Container.getService("CrossApplicationNavigation");
                if (oCrossAppNav) {
                    oCrossAppNav.toExternal({
                        target: {
                            shellHash: "#JobDashboard-display"
                        }
                    });
                } else {
                    window.open("/dashboard/index.html", "_blank");
                }
            },
            onOpenAnalytics: function () {
                // Navigate within Fiori Launchpad Sandbox instantly
                var oCrossAppNav = sap.ushell && sap.ushell.Container && sap.ushell.Container.getService("CrossApplicationNavigation");
                if (oCrossAppNav) {
                    oCrossAppNav.toExternal({
                        target: {
                            shellHash: "#JobAnalytics-display"
                        }
                    });
                } else {
                    window.open("/analytic/index.html", "_blank");
                }
            },

            onAfterRendering: function () {
                var oMacroTable = this.byId("Table");
                if (oMacroTable) {
                    // Try to wait for the macro content (which is an MDC table)
                    var oContent = oMacroTable.getContent();
                    if (oContent) {
                        // Check if it is an MDC Table and has setSelectionMode
                        if (typeof oContent.setSelectionMode === 'function') {
                            oContent.setSelectionMode("Multi");
                        }
                    }
                }
            }
        });
    }
);
