/* ==========================================================================
   L'Oréal Beauty Assistant — Plain JavaScript
   Handles conversation history, remembered user details, message bubbles,
   loading states, error handling, and preview responses.
   ========================================================================== */

// ---------- DOM Elements ----------
const chatForm = document.getElementById("chatForm");
const userInput = document.getElementById("userInput");
const sendBtn = document.getElementById("sendBtn");
const chatWindow = document.getElementById("chatWindow");
const resetChatBtn = document.getElementById("resetChatBtn");
const messageCountEl = document.getElementById("messageCount");

// Error banner elements
const errorBanner = document.getElementById("errorBanner");
const errorMessageText = document.getElementById("errorMessageText");
const retryBtn = document.getElementById("retryBtn");
const dismissErrorBtn = document.getElementById("dismissErrorBtn");

// Remembered profile display elements
const profileNameEl = document.getElementById("profileName");
const profileSkinEl = document.getElementById("profileSkin");
const profileHairEl = document.getElementById("profileHair");
const profilePrefsEl = document.getElementById("profilePrefs");
const profileRecommendedEl = document.getElementById("profileRecommended");

// Latest user question display elements
const latestQuestionBar = document.getElementById("latestQuestionBar");
const latestQuestionText = document.getElementById("latestQuestionText");

// Category nav buttons & suggested question buttons
const promptButtons = document.querySelectorAll("[data-prompt]");
const footerLinks = document.querySelectorAll("[data-footer-info]");

// ==========================================================================
// CLOUDFLARE WORKER CONFIGURATION
// Replace the placeholder URL below with your professor's class-hosted
// Cloudflare Worker URL from your project README.
// Never put API keys or credentials in frontend files.
// ==========================================================================
const CLOUDFLARE_WORKER_URL = "https://loreal-chatbot.kalaya-nelson5.workers.dev/";

// ---------- System Prompt & Chatbot Personality ----------
const OFF_TOPIC_RESPONSE =
  "I'm your L'Oréal Beauty Assistant! I'm here to help with beauty products, skincare, makeup, haircare, and personalized beauty routines. Is there something beauty-related I can help you with?";

const SYSTEM_PROMPT = `You are the L'Oréal Beauty Assistant, a friendly, knowledgeable, and professional beauty advisor.

PRIMARY PURPOSE:
Your primary purpose is to help customers discover L'Oréal products and receive personalized beauty recommendations.

CAPABILITIES:
- Recommend skincare products based on skin type and concerns.
- Suggest makeup products based on preferences and desired looks.
- Recommend haircare and hair color products based on hair type and hair concerns.
- Help users create morning and evening skincare routines.
- Explain clearly how to apply and layer beauty products.
- Help users understand cosmetic product ingredients and their general purposes (such as hydration, exfoliation, or brightening).
- Suggest beauty routines tailored to individual preferences, lifestyle, and goals.
- Ask thoughtful follow-up questions to personalize recommendations further.

PERSONALIZATION:
- Remember information users share during the conversation, including their name, skin type, hair type, preferences, and previous questions.
- Naturally use this remembered context when answering future questions so the consultation feels continuous and personal.

STRICT SCOPE & SAFETY RESTRICTIONS:
- Only answer questions related to L'Oréal products, beauty, skincare, makeup, haircare, hair color, fragrances, beauty routines, and closely related beauty topics.
- If a user asks an unrelated question, politely respond with this exact message:
  "${OFF_TOPIC_RESPONSE}"
- Never invent L'Oréal product names, ingredients, product availability, prices, or medical claims (do not diagnose or prescribe treatments for medical skin or scalp conditions).
- Be honest when you do not know something or when availability/formulation details should be verified on the official product packaging or website.
- Keep responses friendly, organized, helpful, and easy to understand.`;

let conversationHistory = [];
let isGenerating = false;
let lastFailedMessage = "";

const userProfile = {
  name: "",
  skinType: "",
  hairType: "",
  preferences: [],
  previousTopics: [],
  recommendedProducts: []
};

function buildSystemMessage() {
  const rememberedParts = [];
  if (userProfile.name) rememberedParts.push(`Customer Name: ${userProfile.name}`);
  if (userProfile.skinType) rememberedParts.push(`Skin Type: ${userProfile.skinType}`);
  if (userProfile.hairType) rememberedParts.push(`Hair Type: ${userProfile.hairType}`);
  if (userProfile.preferences.length > 0) {
    rememberedParts.push(`Preferences: ${userProfile.preferences.join(", ")}`);
  }
  if (userProfile.previousTopics.length > 0) {
    rememberedParts.push(`Previous Questions/Topics: ${userProfile.previousTopics.join(" | ")}`);
  }
  if (userProfile.recommendedProducts.length > 0) {
    rememberedParts.push(
      `Previously Recommended Products: ${userProfile.recommendedProducts.join(", ")}`
    );
  }

  if (rememberedParts.length === 0) {
    return SYSTEM_PROMPT;
  }

  return (
    SYSTEM_PROMPT +
    "\n\nREMEMBERED CUSTOMER PROFILE FOR THIS CONVERSATION:\n- " +
    rememberedParts.join("\n- ")
  );
}

// ---------- Initialization ----------
function initializeChat() {
  userProfile.name = "";
  userProfile.skinType = "";
  userProfile.hairType = "";
  userProfile.preferences = [];
  userProfile.previousTopics = [];
  userProfile.recommendedProducts = [];
  lastFailedMessage = "";

  conversationHistory = [{ role: "system", content: buildSystemMessage() }];

  chatWindow.innerHTML = "";
  hideError();
  updateLatestQuestionDisplay("");
  updateProfileDisplay();

  const welcomeMessage =
    "Welcome to the L'Oréal Beauty Assistant.\n\n" +
    "I'm here to help you discover L'Oréal skincare, makeup, haircare, hair color, and fragrances, " +
    "and create personalized beauty routines tailored to you. Share your name, skin or hair type, " +
    "or ask a question to begin.";

  appendMessage("ai", welcomeMessage);
  conversationHistory.push({ role: "assistant", content: welcomeMessage });
  updateMessageCounter();
}

// ---------- Profile Memory Extraction ----------
function updateProfileFromText(text) {
  const cleaned = text.trim();

  // Detect name patterns (e.g., "My name is Maya", "I'm Maya", "Call me Maya")
  const explicitNameMatch = cleaned.match(
    /(?:my name is|call me)\s+([a-z]{2,20})\b/i
  );
  const introNameMatch = cleaned.match(
    /(?:^|[\s,.!?])(?:i\s+am|i'm)\s+([A-Z][a-z]{1,20})\b/
  );
  const nameMatch = explicitNameMatch || introNameMatch;
  if (nameMatch) {
    const candidate = nameMatch[1];
    const ignoredWords = [
      "looking", "trying", "interested", "having", "dry", "oily",
      "combination", "sensitive", "here", "ready", "not", "very",
      "wondering", "curious", "new", "asking", "hungry", "tired"
    ];
    if (!ignoredWords.includes(candidate.toLowerCase())) {
      userProfile.name =
        candidate.charAt(0).toUpperCase() + candidate.slice(1).toLowerCase();
    }
  }

  // Detect skin type
  const skinTypes = [
    { pattern: /\bcombination\s+skin\b|\bcombo\s+skin\b/i, label: "Combination" },
    { pattern: /\bsensitive\s+skin\b|\bmy skin is sensitive\b/i, label: "Sensitive" },
    { pattern: /\bdry\s+skin\b|\bmy skin is dry\b|\bdehydrated\s+skin\b/i, label: "Dry" },
    { pattern: /\boily\s+skin\b|\bmy skin is oily\b|\bacne-prone\b/i, label: "Oily / Blemish-Prone" },
    { pattern: /\bnormal\s+skin\b|\bbalanced\s+skin\b/i, label: "Normal" },
    { pattern: /\bmature\s+skin\b|\baging\s+skin\b/i, label: "Mature" }
  ];
  for (const item of skinTypes) {
    if (item.pattern.test(cleaned)) {
      userProfile.skinType = item.label;
      break;
    }
  }

  // Detect hair type
  const hairMatches = [];
  const hairKeywords = [
    { pattern: /\bcurly\b|\bcoily\b|\bcurls\b/i, label: "Curly" },
    { pattern: /\bwavy\b|\bwaves\b/i, label: "Wavy" },
    { pattern: /\bstraight\b/i, label: "Straight" },
    { pattern: /\bfine\s+hair\b|\bthin\s+hair\b/i, label: "Fine" },
    { pattern: /\bthick\s+hair\b|\bcoarse\b/i, label: "Thick" },
    { pattern: /\bcolor-treated\b|\bdyed\b|\bbleached\b/i, label: "Color-Treated" },
    { pattern: /\bfrizzy\b|\bdry\s+hair\b|\bdamaged\b/i, label: "Dry / Frizz-Prone" }
  ];
  for (const item of hairKeywords) {
    if (item.pattern.test(cleaned) && !hairMatches.includes(item.label)) {
      hairMatches.push(item.label);
    }
  }
  if (hairMatches.length > 0) {
    userProfile.hairType = hairMatches.join(", ");
  }

  // Detect preferences
  const prefKeywords = [
    { pattern: /\bfragrance-free\b|\bunscented\b/i, label: "Fragrance-free" },
    { pattern: /\bmatte\b/i, label: "Matte finish" },
    { pattern: /\bglowing\b|\bdewy\b|\bradiant\b|\bluminous\b/i, label: "Radiant / Dewy finish" },
    { pattern: /\blightweight\b|\bsheer\b|\bnatural\s+look\b/i, label: "Lightweight & natural" },
    { pattern: /\bhydrat|\bmoistur/i, label: "Deep hydration" },
    { pattern: /\banti-aging\b|\bwrinkle|\bfirming\b|\bretinol\b/i, label: "Anti-aging care" },
    { pattern: /\bvolume\b|\blength\b/i, label: "Volume & lift" },
    { pattern: /\bwarm\b|\bwoody\b|\bfloral\b|\bvanilla\b|\bfresh\b/i, label: "Signature scent notes" }
  ];
  for (const item of prefKeywords) {
    if (item.pattern.test(cleaned) && !userProfile.preferences.includes(item.label)) {
      userProfile.preferences.push(item.label);
    }
  }

  updateProfileDisplay();
}

function extractRecommendedProducts(replyText) {
  const knownProducts = [
    "Revitalift 1.5% Pure Hyaluronic Acid Serum",
    "Revitalift Triple Power Day Lotion",
    "Revitalift Pressed Night Cream",
    "True Match Lumi Glotion",
    "True Match Super-Blendable Foundation",
    "Infallible 32H Fresh Wear Foundation",
    "Telescopic Lift Mascara",
    "Color Riche Satin Lipstick",
    "Excellence Crème",
    "Casting Crème Gloss",
    "Superior Preference",
    "Elvive Hyaluron Plump Hydrating Shampoo & Conditioner",
    "Elvive EverPure Bond Repair",
    "Elvive Extraordinary Oil Serum",
    "Bright Reveal",
    "Age Perfect",
    "Lancôme La Vie Est Belle",
    "YSL Libre Intense",
    "Giorgio Armani Acqua di Giò"
  ];

  const lowerReply = replyText.toLowerCase();
  for (const product of knownProducts) {
    if (
      lowerReply.includes(product.toLowerCase()) &&
      !userProfile.recommendedProducts.includes(product)
    ) {
      userProfile.recommendedProducts.push(product);
    }
  }
  updateProfileDisplay();
}

function updateLatestQuestionDisplay(questionText) {
  if (questionText) {
    latestQuestionText.textContent = questionText;
    latestQuestionBar.hidden = false;
  } else {
    latestQuestionText.textContent = "";
    latestQuestionBar.hidden = true;
  }
}

function updateProfileDisplay() {
  setProfileField(profileNameEl, userProfile.name, "Not shared yet");
  setProfileField(profileSkinEl, userProfile.skinType, "Not shared yet");
  setProfileField(profileHairEl, userProfile.hairType, "Not shared yet");
  setProfileField(
    profilePrefsEl,
    userProfile.preferences.length > 0 ? userProfile.preferences.join(", ") : "",
    "Not shared yet"
  );
  setProfileField(
    profileRecommendedEl,
    userProfile.recommendedProducts.length > 0
      ? userProfile.recommendedProducts.join(", ")
      : "",
    "None yet"
  );
}

function setProfileField(element, value, emptyLabel = "Not shared yet") {
  if (value) {
    element.textContent = value;
    element.classList.remove("is-empty");
  } else {
    element.textContent = emptyLabel;
    element.classList.add("is-empty");
  }
}

// ---------- Message Rendering ----------
function formatTimeNow() {
  return new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function appendMessage(sender, text) {
  const row = document.createElement("div");
  row.className = `message-row ${sender}`;

  const meta = document.createElement("span");
  meta.className = "message-meta";
  const senderLabel = sender === "user" ? (userProfile.name || "You") : "L'Oréal Advisor";
  meta.textContent = `${senderLabel} · ${formatTimeNow()}`;

  const bubble = document.createElement("div");
  bubble.className = "message-bubble";
  bubble.textContent = text;

  row.appendChild(meta);

  if (sender === "ai") {
    const bodyRow = document.createElement("div");
    bodyRow.className = "message-body-row";

    const avatar = document.createElement("span");
    avatar.className = "message-avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = "L";

    bodyRow.appendChild(avatar);
    bodyRow.appendChild(bubble);
    row.appendChild(bodyRow);
  } else {
    row.appendChild(bubble);
  }

  chatWindow.appendChild(row);
  scrollToBottom();
}

function showLoadingIndicator() {
  const existing = document.getElementById("loadingIndicator");
  if (existing) return;

  const row = document.createElement("div");
  row.id = "loadingIndicator";
  row.className = "message-row ai";

  const meta = document.createElement("span");
  meta.className = "message-meta";
  meta.textContent = "L'Oréal Advisor";

  const bodyRow = document.createElement("div");
  bodyRow.className = "message-body-row";

  const avatar = document.createElement("span");
  avatar.className = "message-avatar";
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = "L";

  const bubble = document.createElement("div");
  bubble.className = "loading-bubble";
  bubble.innerHTML =
    '<span class="typing-dots" aria-hidden="true"><span></span><span></span><span></span></span>' +
    "<span>Crafting your recommendation…</span>";

  bodyRow.appendChild(avatar);
  bodyRow.appendChild(bubble);
  row.appendChild(meta);
  row.appendChild(bodyRow);
  chatWindow.appendChild(row);
  scrollToBottom();
}

function hideLoadingIndicator() {
  const loader = document.getElementById("loadingIndicator");
  if (loader) {
    loader.remove();
  }
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    chatWindow.scrollTop = chatWindow.scrollHeight;
  });
}

function updateMessageCounter() {
  const visibleCount = chatWindow.querySelectorAll(".message-row:not(#loadingIndicator)").length;
  messageCountEl.textContent = `${visibleCount} ${visibleCount === 1 ? "message" : "messages"}`;
}

// ---------- Error Handling ----------
function showError(message, failedText = "") {
  lastFailedMessage = failedText;
  errorMessageText.textContent = message;
  retryBtn.hidden = !failedText;
  errorBanner.hidden = false;
}

function hideError() {
  errorBanner.hidden = true;
  lastFailedMessage = "";
}

// ---------- AI Response Pipeline (Cloudflare Worker -> OpenAI) ----------
function isWorkerConfigured() {
  return (
    typeof CLOUDFLARE_WORKER_URL === "string" &&
    CLOUDFLARE_WORKER_URL.trim() !== "" &&
    !CLOUDFLARE_WORKER_URL.includes("YOUR-CLOUDFLARE-WORKER-URL")
  );
}

async function fetchAIResponse(userMessage) {
  // Keep the system message updated with the latest remembered customer profile
  if (conversationHistory.length > 0 && conversationHistory[0].role === "system") {
    conversationHistory[0].content = buildSystemMessage();
  }

  // Send conversation history to the class-hosted Cloudflare Worker
  if (isWorkerConfigured()) {
    const requestOptions = {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4.1",
        messages: conversationHistory
      })
    };

    let response;
    try {
      response = await fetch(CLOUDFLARE_WORKER_URL.trim(), requestOptions);
    } catch (networkError) {
      // In preview iframes or restricted networks where *.workers.dev is blocked,
      // fall back to the local dev preview proxy routing to the same Cloudflare Worker.
      try {
        const proxyResponse = await fetch("/__worker-proxy/", requestOptions);
        const contentType = proxyResponse.headers.get("content-type") || "";
        if (proxyResponse.ok || contentType.includes("application/json")) {
          response = proxyResponse;
        }
      } catch (_proxyError) {
        // Ignore fallback failure and report the original network error below
      }

      if (!response) {
        console.error("Cloudflare Worker fetch failed:", networkError);
        const reason = networkError?.message ? ` (${networkError.message})` : "";
        throw new Error(
          `Network error: Unable to reach the L'Oréal Beauty Assistant service${reason}. Please check your connection and Worker URL.`
        );
      }
    }

    if (!response.ok) {
      let detail = "";
      try {
        const errorData = await response.json();
        detail = errorData?.error?.message || errorData?.message || "";
      } catch (_parseError) {
        // Ignore JSON parse errors on non-JSON error responses
      }
      throw new Error(
        detail
          ? `Service error (${response.status}): ${detail}`
          : `Unable to reach the beauty advisor service (HTTP ${response.status}). Please try again.`
      );
    }

    let data;
    try {
      data = await response.json();
    } catch (_jsonError) {
      throw new Error(
        "The beauty advisor returned an unreadable response. Please try again."
      );
    }

    if (data?.error?.message) {
      throw new Error(`Service error: ${data.error.message}`);
    }

    const reply = data?.choices?.[0]?.message?.content;

    if (!reply || typeof reply !== "string") {
      throw new Error(
        "The beauty advisor returned an unexpected response format. Please try again."
      );
    }

    return reply.trim();
  }

  // Local preview mode while CLOUDFLARE_WORKER_URL is still the placeholder
  await new Promise((resolve) => setTimeout(resolve, 650));
  return generatePreviewResponse(userMessage);
}

function isBeautyRelated(text) {
  const lower = text.toLowerCase().trim();
  const beautyKeywords = [
    "l'oreal", "loreal", "beauty", "skin", "skincare", "makeup", "cosmetic",
    "hair", "haircare", "shampoo", "conditioner", "serum", "moisturizer",
    "cleanser", "sunscreen", "spf", "retinol", "hyaluronic", "niacinamide",
    "vitamin c", "glycolic", "salicylic", "ceramide", "ingredient", "routine",
    "foundation", "concealer", "mascara", "lipstick", "lip", "blush", "brow",
    "eyeliner", "eyeshadow", "primer", "powder", "glow", "matte", "dewy",
    "dry", "oily", "combination", "sensitive", "acne", "wrinkle", "aging",
    "dark spot", "hydrat", "frizz", "curl", "color", "dye", "bleach",
    "fragrance", "perfume", "scent", "cologne", "revitalift", "elvive",
    "infallible", "telescopic", "true match", "excellence", "preference",
    "casting", "everpure", "bright reveal", "my name", "call me",
    "recommend", "how to use", "how do i use", "how should i use", "apply",
    "earlier", "previous recommendation"
  ];

  if (beautyKeywords.some((keyword) => lower.includes(keyword))) {
    return true;
  }

  // Allow simple greetings or pure name introductions without letting off-topic questions slip through
  const greetingPattern = /^(hi|hello|hey|good morning|good afternoon|good evening|thanks|thank you)[!.\s]*$/i;
  const pureNameIntroPattern = /^(i am|i'm)\s+[a-z]{2,20}[.!]*$/i;
  return greetingPattern.test(lower) || pureNameIntroPattern.test(lower);
}

function generatePreviewResponse(message) {
  const lower = message.toLowerCase();

  // Enforce strict topic restriction
  if (!isBeautyRelated(lower)) {
    return OFF_TOPIC_RESPONSE;
  }

  const greeting = userProfile.name ? `${userProfile.name}, ` : "";
  const skinNote = userProfile.skinType
    ? ` Since you shared that you have ${userProfile.skinType.toLowerCase()} skin, `
    : " ";

  if (
    lower.includes("ingredient") ||
    lower.includes("hyaluronic") ||
    lower.includes("retinol") ||
    lower.includes("niacinamide") ||
    lower.includes("vitamin c") ||
    lower.includes("glycolic")
  ) {
    return (
      `${greeting}here is a quick guide to key skincare ingredients commonly used in L'Oréal formulas:\n` +
      "• Hyaluronic Acid: Draws and holds moisture at the skin's surface to plump and hydrate.\n" +
      "• Niacinamide: Helps support the skin barrier, visibly calm redness, and balance uneven tone.\n" +
      "• Vitamin C: An antioxidant that helps boost radiance and brighten the look of dullness.\n" +
      "• Retinol: Supports surface skin renewal to help smooth fine lines over time (best used at night with daytime SPF).\n\n" +
      "Which skin concern are you focusing on most right now?"
    );
  }

  if (
    lower.includes("how to use") ||
    lower.includes("how do i use") ||
    lower.includes("how should i use") ||
    lower.includes("apply") ||
    lower.includes("order") ||
    lower.includes("layer")
  ) {
    return (
      `${greeting}a helpful rule of thumb is applying products from thinnest to thickest texture:\n` +
      "1. Cleanser on damp skin, gently rinsed.\n" +
      "2. Water-based serum (such as Revitalift 1.5% Pure Hyaluronic Acid Serum) pressed onto slightly damp skin.\n" +
      "3. Moisturizer to lock in hydration.\n" +
      "4. Broad-spectrum SPF every morning as your final skincare step before makeup.\n\n" +
      "Is there a specific L'Oréal product you would like step-by-step application tips for?"
    );
  }

  if (lower.includes("routine") || lower.includes("skincare") || lower.includes("serum") || lower.includes("skin")) {
    return (
      `${greeting}here is a tailored L'Oréal Paris skincare routine:${skinNote}` +
      "in the morning, cleanse gently, apply Revitalift 1.5% Pure Hyaluronic Acid Serum on damp skin for hydration, " +
      "and follow with Revitalift Triple Power Day Lotion with SPF 30. " +
      "In the evening, cleanse and use Revitalift Pressed Night Cream with Retinol + Niacinamide.\n\n" +
      "Would you like me to adjust any step for sensitivity, brightening, or oil control?"
    );
  }

  if (lower.includes("makeup") || lower.includes("foundation") || lower.includes("mascara") || lower.includes("lip")) {
    const finishHint = userProfile.skinType === "Dry"
      ? "True Match Lumi Glotion paired with True Match Super-Blendable Foundation creates a hydrated, radiant finish."
      : "Infallible 32H Fresh Wear Foundation offers breathable, long-wearing coverage that stays comfortable.";
    return (
      `${greeting}for a polished L'Oréal makeup look: ${finishHint} ` +
      "Pair it with Telescopic Lift Mascara for lifted, separated lashes and Color Riche Satin Lipstick for conditioning color.\n\n" +
      "What kind of finish do you prefer—natural, radiant, or matte?"
    );
  }

  if (lower.includes("hair color") || lower.includes("dye") || lower.includes("shade") || lower.includes("balayage")) {
    return (
      `${greeting}for rich, luminous at-home hair color, L'Oréal Excellence Crème offers 100% gray coverage with a triple-care routine, ` +
      "while Casting Crème Gloss gives ammonia-free shine that lasts up to 28 washes. " +
      "For multidimensional shimmer, Superior Preference is a great option.\n\n" +
      "What is your current hair shade, and what tone are you hoping to achieve?"
    );
  }

  if (lower.includes("hair") || lower.includes("shampoo") || lower.includes("frizz") || lower.includes("curl")) {
    const hairContext = userProfile.hairType
      ? `tailored for your ${userProfile.hairType.toLowerCase()} hair`
      : "for lasting softness and resilience";
    return (
      `${greeting}here is a L'Oréal Elvive haircare pairing ${hairContext}: ` +
      "try Elvive Hyaluron Plump Hydrating Shampoo & Conditioner for weightless moisture, or Elvive EverPure Bond Repair " +
      "if your hair is color-treated or heat-styled. Finish damp lengths with Elvive Extraordinary Oil Serum for smoothness and shine.\n\n" +
      "How do you usually style your hair, and what is your top hair concern?"
    );
  }

  if (lower.includes("fragrance") || lower.includes("perfume") || lower.includes("scent")) {
    return (
      `${greeting}across L'Oréal Groupe fragrance houses, you can explore distinct scent profiles:\n` +
      "• Warm & Floral: Lancôme La Vie Est Belle (iris, jasmine, warm vanilla praline)\n" +
      "• Bold & Amber-Woody: YSL Libre Intense (lavender blossom, orange blossom, warm vanilla)\n" +
      "• Crisp & Aquatic: Giorgio Armani Acqua di Giò (bergamot, neroli, cedarwood)\n\n" +
      "Do you prefer fresh citrus, soft florals, or warm woody notes?"
    );
  }

  if (
    lower.includes("earlier") ||
    lower.includes("what did you recommend") ||
    lower.includes("previous recommendation")
  ) {
    if (userProfile.recommendedProducts.length > 0) {
      return (
        `${greeting}earlier in our consultation I recommended:\n` +
        userProfile.recommendedProducts.map((item) => `• ${item}`).join("\n") +
        "\n\nWould you like usage tips or a routine order for any of these products?"
      );
    }
    return (
      `${greeting}we haven't picked specific products yet—tell me about your skin type, hair type, or beauty goals ` +
      "and I'll put together tailored L'Oréal recommendations for you."
    );
  }

  return (
    `${greeting}I'd love to help with your beauty routine! I have noted your profile` +
    `${userProfile.skinType ? ` (Skin: ${userProfile.skinType})` : ""}` +
    `${userProfile.hairType ? ` (Hair: ${userProfile.hairType})` : ""}. ` +
    "Ask me about L'Oréal skincare routines, ingredient benefits, makeup looks, Elvive haircare, Excellence hair color, or fragrances—and let me know your beauty goals."
  );
}

// ---------- Form Submission & Event Handlers ----------
async function requestAssistantReply(userMessage) {
  isGenerating = true;
  sendBtn.disabled = true;
  showLoadingIndicator();

  try {
    const aiReply = await fetchAIResponse(userMessage);
    hideLoadingIndicator();
    extractRecommendedProducts(aiReply);
    appendMessage("ai", aiReply);
    conversationHistory.push({ role: "assistant", content: aiReply });
    updateMessageCounter();
  } catch (error) {
    hideLoadingIndicator();
    showError(
      error.message || "We couldn't generate a response right now. Please try again.",
      userMessage
    );
  } finally {
    isGenerating = false;
    sendBtn.disabled = false;
    userInput.focus();
  }
}

async function handleSendMessage(rawMessage) {
  if (isGenerating) return;

  const trimmed = rawMessage.trim();
  if (!trimmed) {
    showError("Please enter a beauty question or topic before sending.");
    userInput.focus();
    return;
  }

  hideError();

  // Update the Latest Question banner right above the conversation response area
  updateLatestQuestionDisplay(trimmed);

  // Update remembered profile, track question history, and append user bubble
  updateProfileFromText(trimmed);
  if (userProfile.previousTopics.length < 5) {
    userProfile.previousTopics.push(trimmed.slice(0, 80));
  } else {
    userProfile.previousTopics.shift();
    userProfile.previousTopics.push(trimmed.slice(0, 80));
  }

  appendMessage("user", trimmed);
  conversationHistory.push({ role: "user", content: trimmed });
  updateMessageCounter();

  userInput.value = "";
  await requestAssistantReply(trimmed);
}

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  handleSendMessage(userInput.value);
});

resetChatBtn.addEventListener("click", () => {
  initializeChat();
  userInput.focus();
});

retryBtn.addEventListener("click", () => {
  if (lastFailedMessage && !isGenerating) {
    const messageToRetry = lastFailedMessage;
    hideError();
    requestAssistantReply(messageToRetry);
  }
});

dismissErrorBtn.addEventListener("click", () => {
  hideError();
});

// Wire header category links and suggested question buttons
promptButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const prompt = button.getAttribute("data-prompt");
    if (prompt) {
      handleSendMessage(prompt);
    }
  });
});

// Wire footer info links cleanly without dead clicks
footerLinks.forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    const topic = link.getAttribute("data-footer-info");
    const infoMessages = {
      privacy: "Session details like your name, skin type, and hair preferences are only kept temporarily in your browser for this consultation.",
      terms: "This L'Oréal Beauty Assistant is an educational web project providing general product discovery and routine guidance.",
      contact: "Have a specific beauty question? Type it directly in the consultation chat above and I'll be happy to help."
    };
    if (infoMessages[topic]) {
      appendMessage("ai", infoMessages[topic]);
      updateMessageCounter();
    }
  });
});

// Start consultation on page load
initializeChat();
