import {createNamedLogger} from "./utils/shared_logging_setup";

import "./global_styles.css";

const logger = createNamedLogger("installation-greeting", false);

const installWarningsList = document.getElementById("install-warnings") as HTMLOListElement;
if (!installWarningsList) logger.error("install-warnings list not found in installation_greeting.ts");

const reassuranceDiv = document.getElementById("reassurance") as HTMLDivElement;
if (!reassuranceDiv) logger.error("reassurance div not found in installation_greeting.ts");

const tabUrlStr = window.location.href;
const tabUrl = new URL(tabUrlStr);
const searchParams = tabUrl.searchParams;
const installWarnings = searchParams.get("warnings");
if (installWarnings) {
    const warnings = JSON.parse(installWarnings) as string[];
    warnings.forEach((warning) => {
        const listItem = document.createElement("li");
        listItem.textContent = warning;
        installWarningsList.appendChild(listItem);
    });
} else {
    reassuranceDiv.textContent = "No warnings were found during installation. Enjoy using the extension!";
}
