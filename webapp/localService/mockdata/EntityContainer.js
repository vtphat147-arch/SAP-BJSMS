const mock = {
    executeAction: async function (actionDefinition, actionData, keys, odataRequest) {
        console.log(`Executing mock action: ${actionDefinition.name}`);
        const jobListInterface = await this.base.getEntityInterface("JobList");
        if (!jobListInterface) {
            this.throwError("MockJobList entity set not loaded", 500);
        }

        const entries = await jobListInterface.getAllEntries(odataRequest);

        switch (actionDefinition.name) {
            case "ReleaseJob": {
                const job = entries.find(j => j.JobName === keys.JobName && j.JobCount === keys.JobCount);
                if (!job) this.throwError("Job not found", 404);

                // Only allow releasing Scheduled or Released jobs
                if (job.StatusText !== "Scheduled" && job.StatusText !== "Released") {
                    this.throwError("Only scheduled or waiting jobs can be released.", 400);
                }

                const isImmediate = actionData.IsImmediate === true || actionData.IsImmediate === "X";
                job.StatusText = isImmediate ? "Active" : "Scheduled";
                job.Criticality = isImmediate ? 3 : 2;
                job.StartDate = actionData.StartDate || new Date().toISOString().split('T')[0];
                job.StartTime = actionData.StartTime || new Date().toTimeString().split(' ')[0];
                if (actionData.FrequencyType) {
                    job.FrequencyText = `${actionData.FrequencyType} (${actionData.FrequencyValue})`;
                } else {
                    job.FrequencyText = "Single Run";
                }

                await jobListInterface.updateEntry(keys, job, {}, odataRequest);
                
                odataRequest.addResponseHeader("sap-message", JSON.stringify({
                    code: "001",
                    message: `Job ${keys.JobName} has been released successfully.`,
                    severity: "success"
                }));
                return job;
            }

            case "RepeatWithSchedule": {
                const job = entries.find(j => j.JobName === keys.JobName && j.JobCount === keys.JobCount);
                if (!job) this.throwError("Job not found", 404);

                const nextCount = String(Math.max(...entries.map(e => parseInt(e.JobCount, 10) || 0)) + 1).padStart(6, '0');
                const isImmediate = actionData.IsImmediate === true || actionData.IsImmediate === "X";
                
                // Duplicate the job exactly ("i xì")
                const newJob = {
                    ...job,
                    JobCount: nextCount,
                    StatusText: isImmediate ? "Active" : "Scheduled",
                    Criticality: isImmediate ? 3 : 2,
                    StartDate: actionData.StartDate || new Date().toISOString().split('T')[0],
                    StartTime: actionData.StartTime || new Date().toTimeString().split(' ')[0],
                    DurationInSeconds: 0,
                    DelayInSeconds: 0
                };
                if (actionData.FrequencyType) {
                    newJob.FrequencyText = `${actionData.FrequencyType} (${actionData.FrequencyValue})`;
                } else {
                    newJob.FrequencyText = "Single Run";
                }

                await jobListInterface.addEntry(newJob, odataRequest);
                
                odataRequest.addResponseHeader("sap-message", JSON.stringify({
                    code: "002",
                    message: `Job ${job.JobName} repeated with ID ${nextCount}`,
                    severity: "success"
                }));
                return newJob;
            }

            case "CopyJob": {
                const job = entries.find(j => j.JobName === keys.JobName && j.JobCount === keys.JobCount);
                if (!job) this.throwError("Job not found", 404);

                const newJobName = actionData.NewJobName;
                if (entries.some(e => e.JobName === newJobName)) {
                    this.throwError(`Job with name ${newJobName} already exists`, 400);
                }

                const nextCount = String(Math.max(...entries.map(e => parseInt(e.JobCount, 10) || 0)) + 1).padStart(6, '0');
                
                // Duplicate job with new name, but in "Scheduled" status
                const newJob = {
                    ...job,
                    JobName: newJobName,
                    JobCount: nextCount,
                    StatusText: "Scheduled",
                    Criticality: 2,
                    DurationInSeconds: 0,
                    DelayInSeconds: 0,
                    FrequencyText: "Single Run"
                };

                await jobListInterface.addEntry(newJob, odataRequest);

                odataRequest.addResponseHeader("sap-message", JSON.stringify({
                    code: "003",
                    message: `Job copied to ${newJobName} (Status: Scheduled)`,
                    severity: "success"
                }));
                return newJob;
            }

            case "StopJob": {
                const job = entries.find(j => j.JobName === keys.JobName && j.JobCount === keys.JobCount);
                if (!job) this.throwError("Job not found", 404);

                // Only running (Active) jobs can be stopped
                if (job.StatusText !== "Active") {
                    this.throwError("Only running (Active) jobs can be stopped.", 400);
                }

                job.StatusText = "Aborted";
                job.Criticality = 1;
                job.EndDate = new Date().toISOString().split('T')[0];
                job.EndTime = new Date().toTimeString().split(' ')[0];

                await jobListInterface.updateEntry(keys, job, {}, odataRequest);

                odataRequest.addResponseHeader("sap-message", JSON.stringify({
                    code: "004",
                    message: `Job ${keys.JobName} stopped successfully. Status: Aborted`,
                    severity: "info"
                }));
                return job;
            }

            case "DeleteJob": {
                await jobListInterface.removeEntry(keys, odataRequest);

                odataRequest.addResponseHeader("sap-message", JSON.stringify({
                    code: "005",
                    message: `Job ${keys.JobName} deleted.`,
                    severity: "success"
                }));
                return {};
            }

            case "ScheduleJob": {
                const nextCount = String(Math.max(...entries.map(e => parseInt(e.JobCount, 10) || 0)) + 1).padStart(6, '0');
                const isImmediate = actionData.IsImmediate === "X" || actionData.IsImmediate === true;
                const statusText = isImmediate ? "Active" : "Scheduled";
                const criticality = isImmediate ? 3 : 2;

                const newJob = {
                    JobName: actionData.JobName || "New Job",
                    JobCount: nextCount,
                    ProgramName: actionData.ProgramName || "",
                    VariantName: actionData.VariantName || "",
                    StatusText: statusText,
                    Criticality: criticality,
                    StartDate: actionData.StartDate || new Date().toISOString().split('T')[0],
                    StartTime: actionData.StartTime || new Date().toTimeString().split(' ')[0],
                    DurationInSeconds: 0,
                    DelayInSeconds: 0,
                    CreatedBy: "SAP_SYSTEM",
                    JobClass: "C",
                    ExecutingServer: "s40app01_S40_00"
                };

                if (actionData.FrequencyType) {
                    newJob.FrequencyText = `${actionData.FrequencyType} (${actionData.FrequencyValue})`;
                } else {
                    newJob.FrequencyText = "Single Run";
                }

                await jobListInterface.addEntry(newJob, odataRequest);

                odataRequest.addResponseHeader("sap-message", JSON.stringify({
                    code: "006",
                    message: `Job ${newJob.JobName} scheduled successfully with ID ${nextCount}`,
                    severity: "success"
                }));
                return newJob;
            }

            default:
                return undefined;
        }
    }
};

module.exports = mock;
