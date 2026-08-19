(function () {
  const config = window.RESTOCK_CONFIG || {};
  const form = document.querySelector("#subscribe-form");
  const email = document.querySelector("#email");
  const inviteCode = document.querySelector("#invite-code");
  const button = document.querySelector("#subscribe-button");
  const message = document.querySelector("#form-message");
  const submitTimeoutMs = 15000;

  function showMessage(text, kind) {
    message.textContent = text;
    message.className = "form-message " + (kind || "");
  }

  async function loadStatuses() {
    if (!config.statusEndpoint) return;
    try {
      const response = await fetch(config.statusEndpoint + "?v=" + Date.now(), { cache: "no-store" });
      if (!response.ok) throw new Error("status unavailable");
      const data = await response.json();
      const states = data.products || {};
      const labels = {
        in_stock: ["有货", "in_stock"],
        out_of_stock: ["无货", "out_of_stock"],
        unknown: ["暂无法确认", "unknown"],
      };
      for (const [key, state] of Object.entries(states)) {
        const [label, className] = labels[state.status] || labels.unknown;
        document.querySelectorAll("[data-status='" + key + "']").forEach((element) => {
          element.className = "status " + className;
          element.querySelector("span:last-child").textContent = label;
        });
      }
      const checks = Object.values(states).map((state) => state.checked_at).filter(Boolean).sort();
      if (checks.length) {
        const checked = new Date(checks.at(-1));
        document.querySelector("#last-checked").textContent = "最近检查：" + checked.toLocaleString("zh-CN", { hour12: false });
      }
    } catch (_) {
      document.querySelector("#last-checked").textContent = "暂时无法读取库存状态。";
    }
  }

  if (!config.subscriptionEndpoint) {
    button.disabled = true;
    showMessage("订阅服务正在配置中，请稍后再试。", "");
  } else form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const address = email.value.trim();
    if (!email.validity.valid || !inviteCode.validity.valid) {
      showMessage("请输入有效的邮箱地址和邀请码。", "error");
      email.focus();
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), submitTimeoutMs);
    button.disabled = true;
    showMessage("正在提交订阅…", "");
    try {
      const response = await fetch(config.subscriptionEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ email: address, inviteCode: inviteCode.value.trim(), website: form.website.value }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "request failed");
      email.value = "";
      inviteCode.value = "";
      showMessage("订阅成功。确认邮件将在下一次检查时发送，补货时也会提醒你。", "success");
    } catch (error) {
      if (error && error.name === "AbortError") {
        showMessage("请求超时，请检查网络后重试。", "error");
      } else {
        showMessage(error && error.message === "邀请码不正确。" ? error.message : "暂时无法提交订阅，请稍后重试。", "error");
      }
    } finally {
      window.clearTimeout(timeoutId);
      button.disabled = false;
    }
  });

  loadStatuses();
  window.setInterval(loadStatuses, 60000);
}());
