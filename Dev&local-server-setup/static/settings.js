document.addEventListener("DOMContentLoaded", () => {
  // =========================
  // helpers
  // =========================
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => document.querySelectorAll(selector);

  function showAlert(message) {
    alert(message);
  }

  async function readJsonSafe(res) {
    try {
      return await res.json();
    } catch {
      return {};
    }
  }

  // =========================
  // tabs
  // =========================
  const tabs = $$(".settings-tab");
  const panels = $$(".settings-panel");

  function activateTab(tabName) {
    tabs.forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.tab === tabName);
    });

    panels.forEach((panel) => {
      panel.classList.toggle("active", panel.id === tabName);
      panel.style.display = panel.id === tabName ? "block" : "none";
    });
  }

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      activateTab(tab.dataset.tab);
    });
  });

  activateTab("account");

  // =========================
  // account
  // route: /settings/account
  // =========================
  const saveAccountBtn = $("#saveAccountBtn");

  if (saveAccountBtn) {
    saveAccountBtn.addEventListener("click", async () => {
      const username = ($("#displayName")?.value || "").trim();
      const email = ($("#email")?.value || "").trim();

      if (!username) {
        showAlert("Display name is required.");
        return;
      }

      if (!email) {
        showAlert("Email is required.");
        return;
      }

      saveAccountBtn.disabled = true;
      saveAccountBtn.textContent = "Saving...";

      try {
        const res = await fetch("/settings/account", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            username,
            email
          })
        });

        const data = await readJsonSafe(res);

        if (!res.ok) {
          showAlert(data.error || "Could not save account settings.");
          return;
        }

        showAlert("Account updated.");
      } catch (err) {
        showAlert("Something went wrong while saving account settings.");
      } finally {
        saveAccountBtn.disabled = false;
        saveAccountBtn.textContent = "Save Account";
      }
    });
  }

  // =========================
  // notifications
  // route optional later
  // =========================
  const saveNotificationsBtn = $("#saveNotificationsBtn");

  if (saveNotificationsBtn) {
    saveNotificationsBtn.addEventListener("click", async () => {
      const emailNotifications = !!$("#emailNotificationsToggle")?.checked;
      const messageAlerts = !!$("#messageAlertsToggle")?.checked;

      // local only for now
      localStorage.setItem("settings_email_notifications", String(emailNotifications));
      localStorage.setItem("settings_message_alerts", String(messageAlerts));

      showAlert("Notification preferences saved.");
    });

    const storedEmail = localStorage.getItem("settings_email_notifications");
    const storedMessages = localStorage.getItem("settings_message_alerts");

    if (storedEmail !== null && $("#emailNotificationsToggle")) {
      $("#emailNotificationsToggle").checked = storedEmail === "true";
    }

    if (storedMessages !== null && $("#messageAlertsToggle")) {
      $("#messageAlertsToggle").checked = storedMessages === "true";
    }
  }

  // =========================
  // privacy
  // route: /settings/privacy
  // =========================
  const savePrivacyBtn = $("#savePrivacyBtn");

  if (savePrivacyBtn) {
    savePrivacyBtn.addEventListener("click", async () => {
      const visibility = $("#profileVisibility")?.value || "everyone";
      const isPrivate = !!$("#privateAccountToggle")?.checked;

      savePrivacyBtn.disabled = true;
      savePrivacyBtn.textContent = "Saving...";

      try {
        const res = await fetch("/settings/privacy", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            visibility,
            private: isPrivate
          })
        });

        const data = await readJsonSafe(res);

        if (!res.ok) {
          showAlert(data.error || "Could not save privacy settings.");
          return;
        }

        showAlert("Privacy updated.");
      } catch (err) {
        showAlert("Something went wrong while saving privacy settings.");
      } finally {
        savePrivacyBtn.disabled = false;
        savePrivacyBtn.textContent = "Save Privacy";
      }
    });
  }

  // =========================
  // password
  // route: /settings/password
  // =========================
  const updatePasswordBtn = $("#updatePasswordBtn");

  if (updatePasswordBtn) {
    updatePasswordBtn.addEventListener("click", async () => {
      const currentPassword = ($("#currentPassword")?.value || "").trim();
      const newPassword = ($("#newPassword")?.value || "").trim();
      const confirmPassword = ($("#confirmPassword")?.value || "").trim();

      if (!currentPassword || !newPassword || !confirmPassword) {
        showAlert("Fill out all password fields.");
        return;
      }

      if (newPassword.length < 6) {
        showAlert("New password must be at least 6 characters.");
        return;
      }

      if (newPassword !== confirmPassword) {
        showAlert("New passwords do not match.");
        return;
      }

      updatePasswordBtn.disabled = true;
      updatePasswordBtn.textContent = "Updating...";

      try {
        const res = await fetch("/settings/password", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            current: currentPassword,
            new: newPassword,
            confirm: confirmPassword
          })
        });

        const data = await readJsonSafe(res);

        if (!res.ok) {
          showAlert(data.error || "Could not update password.");
          return;
        }

        $("#currentPassword").value = "";
        $("#newPassword").value = "";
        $("#confirmPassword").value = "";

        showAlert("Password updated.");
      } catch (err) {
        showAlert("Something went wrong while updating password.");
      } finally {
        updatePasswordBtn.disabled = false;
        updatePasswordBtn.textContent = "Update Password";
      }
    });
  }

  // =========================
  // delete account
  // route: /settings/delete-account
  // =========================
  const deleteAccountBtn = $("#deleteAccountBtn");

  if (deleteAccountBtn) {
    deleteAccountBtn.addEventListener("click", async () => {
      const password = ($("#deletePassword")?.value || "").trim();

      if (!password) {
        showAlert("Enter your password first.");
        return;
      }

      const confirmed = confirm("Are you sure you want to delete your account? This cannot be undone.");
      if (!confirmed) return;

      deleteAccountBtn.disabled = true;
      deleteAccountBtn.textContent = "Deleting...";

      try {
        const res = await fetch("/settings/delete-account", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            password
          })
        });

        const data = await readJsonSafe(res);

        if (!res.ok) {
          showAlert(data.error || "Could not delete account.");
          return;
        }

        window.location.href = data.redirect || "/login";
      } catch (err) {
        showAlert("Something went wrong while deleting your account.");
      } finally {
        deleteAccountBtn.disabled = false;
        deleteAccountBtn.textContent = "Delete Account";
      }
    });
  }

   // =========================
  // feedback
  // route: /settings/feedback
  // =========================
  const submitFeedbackBtn = $("#submitFeedbackBtn");

  if (submitFeedbackBtn) {
    submitFeedbackBtn.addEventListener("click", async () => {
      const feedback = ($("#feedbackText")?.value || "").trim();

      if (!feedback) {
        showAlert("Write some feedback first.");
        return;
      }

      submitFeedbackBtn.disabled = true;
      submitFeedbackBtn.textContent = "Sending...";

      try {
        const res = await fetch("/settings/feedback", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            feedback
          })
        });

        const data = await readJsonSafe(res);

        if (!res.ok) {
          showAlert(data.error || "Could not send feedback.");
          return;
        }

        $("#feedbackText").value = "";
        showAlert("Feedback sent. Thank you!");
      } catch (err) {
        showAlert("Something went wrong while sending feedback.");
      } finally {
        submitFeedbackBtn.disabled = false;
        submitFeedbackBtn.textContent = "Submit Feedback";
      }
    });
  }
});