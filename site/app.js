(function () {
  const config = window.RESTOCK_CONFIG || {};
  const form = document.querySelector("#subscribe-form");
  const email = document.querySelector("#email");
  const button = document.querySelector("#subscribe-button");
  const message = document.querySelector("#form-message");

  function showMessage(text, kind) {
    message.textContent = text;
    message.className = `form-message ${kind || ""}`;
  }

  if (!config.subscriptionEndpoint) {
    button.disabled = true;
    showMessage("订阅服务正在配置中，请稍后再试。", "");
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const address = email.value.trim();
    if (!email.validity.valid) {
      showMessage("请输入有效的邮箱地址。", "error");
      email.focus();
      return;
    }

    button.disabled = true;
    showMessage("正在提交订阅…", "");
    try {
      const response = await fetch(config.subscriptionEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: address, website: form.website.value }),
      });
      if (!response.ok) throw new Error("request failed");
      email.value = "";
      showMessage("请查看邮箱并点击确认链接，确认后即可接收补货提醒。", "success");
    } catch (_) {
      showMessage("暂时无法提交订阅，请稍后重试。", "error");
    } finally {
      button.disabled = false;
    }
  });
}());
