
import { createClient } from "npm:@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@10.4.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://snoopy-3d.github.io",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function clean(value: unknown, max = 200): string {
  return typeof value === "string"
    ? value.trim().slice(0, max)
    : "";
}

const ownerEmail = "snoopy_3d@bk.ru";

async function sendViaMailRu(orderNumber: string, subject: string, text: string, password: string) {
  try {
    const transport = nodemailer.createTransport({
      host: "smtp.mail.ru",
      port: 465,
      secure: true,
      auth: { user: ownerEmail, pass: password },
      connectionTimeout: 5_000,
      greetingTimeout: 5_000,
      socketTimeout: 8_000,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    const message = await transport.sendMail({
      from: { name: "SNOOPY3D SHOP", address: ownerEmail },
      to: ownerEmail,
      subject,
      text,
    });
    if (message.accepted.length === 1) {
      console.info("Order email accepted by Mail.ru", orderNumber);
      return "accepted";
    }
    console.error("Order email recipient rejected by Mail.ru", orderNumber);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error &&
      typeof error.code === "string" && /^[A-Z0-9_]{1,30}$/.test(error.code)
      ? error.code : "SMTP_ERROR";
    console.error("Order email failed via Mail.ru", orderNumber, code);
  }
  return "failed";
}

async function notifyOwner(orderNumber: string, details: Record<string, unknown>) {
  const kind = details.service ? "Заявка на услугу" : "Заказ товара";
  const subject = "SNOOPY3D — " + kind.toLowerCase() + " " + orderNumber;
  const text = kind + " " + orderNumber + "\n\n" + JSON.stringify(details, null, 2);
  const smtpPassword = Deno.env.get("MAIL_SMTP_PASSWORD");
  if (smtpPassword) return sendViaMailRu(orderNumber, subject, text, smtpPassword);

  const key = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("MAIL_FROM");
  if (!key || !from) return "not_configured";
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
        "Idempotency-Key": "order/" + orderNumber + "/owner",
      },
      body: JSON.stringify({ from, to: [ownerEmail], subject, text }),
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok && (await response.json()).id) return "accepted";
    console.error("Order notification rejected", orderNumber, response.status);
  } catch {
    console.error("Order notification request failed", orderNumber);
  }
  return "failed";
}

async function notifyTelegram(orderNumber: string, details: {
  service: string; email: string; task: string; total: number;
}) {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const chatId = Deno.env.get("TELEGRAM_CHAT_ID");
  if (!token || !chatId) return "not_configured";

  const text = details.service
    ? `Заявка на услугу ${orderNumber}\n${details.service}\nEmail: ${details.email}\n${details.task}`
    : `Новый заказ ${orderNumber}\nEmail: ${details.email}\nСумма: ${details.total} ₽`;
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, link_preview_options: { is_disabled: true } }),
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok && (await response.json()).ok === true) return "accepted";
    console.error("Order Telegram notification rejected", orderNumber, response.status);
  } catch {
    console.error("Order Telegram notification request failed", orderNumber);
  }
  return "failed";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!url || !serviceKey) {
      console.error("Missing Supabase credentials");
      return json({ error: "Ошибка конфигурации сервера" }, 500);
    }

    const supabase = createClient(url, serviceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const body = await req.json().catch(() => null);

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return json({ error: "Некорректная заявка" }, 400);
    }

    const email = clean(body.email, 200);
    const name = clean(body.name, 120);
    const phone = clean(body.phone, 50);
    const telegram = clean(body.telegram, 100);
    const comment = clean(body.comment, 2000);
    const service = clean(body.service, 120);
    const task = clean(body.task, 3000);
    const file_link = clean(body.file_link, 1000);

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: "Укажите правильный email" }, 400);
    }

    const items: Array<{ id: string; name: string; qty: number; price: number }> = [];
    let total = 0;

    if (service) {
      if (!task) {
        return json({ error: "Опишите необходимую услугу" }, 400);
      }
    } else {
      if (
        !Array.isArray(body.items) ||
        body.items.length === 0 ||
        body.items.length > 50
      ) {
        return json({ error: "Корзина пуста или некорректна" }, 400);
      }

      const requestedItems: Array<{ id: string; qty: number }> = body.items.map((item: { id?: unknown; qty?: unknown } | null) => ({
        id: String(item?.id ?? "").toLowerCase(),
        qty: Number(item?.qty),
      }));

      if (
        requestedItems.some(
          (item) =>
            !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(item.id) ||
            !Number.isInteger(item.qty) ||
            item.qty < 1 ||
            item.qty > 100
        )
      ) {
        return json({ error: "Некорректные товары в корзине" }, 400);
      }

      const ids = [...new Set(requestedItems.map((item) => item.id))];

      const { data: products, error: productsError } =
        await supabase
          .from("products")
          .select("id, name, price, active")
          .in("id", ids);

      if (productsError) throw productsError;

      if (!products || products.length !== ids.length) {
        return json({ error: "Некоторые товары не найдены" }, 400);
      }

      const byId = new Map(
        products.map((product) => [product.id, product])
      );

      let totalKopecks = 0;
      for (const item of requestedItems) {
        const product = byId.get(item.id);

        if (!product || !product.active) {
          return json({ error: "Товар недоступен" }, 400);
        }

        const price = Number(product.price);
        items.push({ id: product.id, name: product.name, qty: item.qty, price });
        totalKopecks += Math.round(price * 100) * item.qty;
      }

      if (!Number.isSafeInteger(totalKopecks) || totalKopecks < 0 || totalKopecks >= 1_000_000_000_000) {
        return json({ error: "Сумма заказа выходит за допустимый диапазон" }, 400);
      }
      total = totalKopecks / 100;
    }

    const { data: order, error: orderError } =
      await supabase
        .from("orders")
        .insert({
          email,
          name: name || null,
          phone: phone || null,
          telegram: telegram || null,
          comment: comment || null,
          service: service || null,
          task: task || null,
          file_link: file_link || null,
          items,
          total,
          status: "Новый",
        })
        .select("order_number")
        .single();

    if (orderError) {
      console.error("Order insert error:", orderError.message);
      return json({ error: "Не удалось сохранить заявку" }, 500);
    }

    const [notification_status, telegram_status] = await Promise.all([
      notifyOwner(order.order_number, {
        email, name, phone, telegram, service, task, file_link, comment, items, total,
      }),
      notifyTelegram(order.order_number, { service, email, task, total }),
    ]);

    return json({
      success: true,
      notification_status,
      telegram_status,
      order_number: order.order_number,
      message: "Заявка успешно принята",
    });
  } catch (error) {
    console.error("place-order error:", error);
    return json({ error: "Ошибка обработки заявки" }, 500);
  }
});
