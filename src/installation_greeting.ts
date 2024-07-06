import {createNamedLogger} from "./utils/shared_logging_setup";

import "./global_styles.css";
import {renderUnknownValue, storageKeyForEulaAcceptance} from "./utils/misc";

const logger = createNamedLogger("installation-greeting", false);

const eulaPrivacyPolicyContainerDiv = document.getElementById("eula-privacy-policy-container") as HTMLDivElement;
if (!eulaPrivacyPolicyContainerDiv) logger.error("eula-privacy-policy-container div not found in installation_greeting.html");

const eulaPrivacyPolicyAcceptanceButton = document.getElementById("accept-eula-and-privacy-policy") as HTMLButtonElement;
if (!eulaPrivacyPolicyAcceptanceButton) logger.error("accept-eula-and-privacy-policy button not found in installation_greeting.html");

const installWarningsList = document.getElementById("install-warnings") as HTMLOListElement;
if (!installWarningsList) logger.error("install-warnings list not found in installation_greeting.html");

const reassuranceDiv = document.getElementById("reassurance") as HTMLDivElement;
if (!reassuranceDiv) logger.error("reassurance div not found in installation_greeting.html");

//hook up logic for button that accepts EULA and privacy policy
eulaPrivacyPolicyAcceptanceButton.onclick = () => {
    chrome.storage.local.set({[storageKeyForEulaAcceptance]: true}).then(
        () => {
            logger.info("EULA and privacy policy acceptance stored");
            eulaPrivacyPolicyAcceptanceButton.disabled = true;
            eulaPrivacyPolicyContainerDiv.hidden = true;
        },
        (reason) => logger.error(`failed to store EULA and privacy policy acceptance: ${renderUnknownValue(reason)}`)
    );
};

//populate installation warnings part of the page
const tabUrlStr = window.location.href;
const installWarnings = new URL(tabUrlStr).searchParams.get("warnings");
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
