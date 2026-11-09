const CONFIG_DEFAULTS = {
  gmailLabel: 'TG_Notified',
  processedLabel: 'kwork-processed',
  searchWindowHours: 24,
  minBudgetRub: 0,
  maxBudgetRub: 0,
  buyerHistoryFilterMode: 'strict',
  minBuyerProjects: 10,
  minBuyerHiredPercent: 35,
  requiredKeywords: '',
  excludedKeywords: '',
  telegramParseMode: 'HTML',
  telegramMessageDelayMs: 1500,
  telegramMaxRetries: 3,
  maxMessagesPerRun: 20
};

let lastTelegramSendAtMs_ = 0;
let nextTelegramSendAtMs_ = 0;

function processKworkEmails() {
  const config = getConfig_();
  getOrCreateLabel_(config.gmailLabel);
  getOrCreateLabel_(config.processedLabel);
  const gmailLabelIds = getGmailLabelIdsByName_([config.gmailLabel, config.processedLabel]);
  const sourceLabelId = gmailLabelIds[config.gmailLabel];
  const processedLabelId = gmailLabelIds[config.processedLabel];
  console.log('processKworkEmails:start label=%s sourceLabelId=%s processedLabel=%s processedLabelId=%s maxMessages=%s', config.gmailLabel, sourceLabelId, config.processedLabel, processedLabelId, config.maxMessagesPerRun);

  if (!sourceLabelId || !processedLabelId) {
    throw new Error('Required Gmail labels were not found through Gmail API.');
  }

  const candidates = listCandidateGmailMessages_(sourceLabelId, config);
  console.log('processKworkEmails:candidates count=%s', candidates.length);

  candidates.forEach(function(candidate) {
    const message = GmailApp.getMessageById(candidate.id);
    console.log('message:start id=%s subject=%s date=%s', message.getId(), message.getSubject(), message.getDate());
    const projects = parseKworkProjectsFromMessage_(message, config);
    console.log('message:projects_found id=%s count=%s', message.getId(), projects.length);
    if (projects.length === 0) {
      console.log('message:not_marked_no_projects id=%s', message.getId());
      return;
    }

    const matchingProjects = projects.filter(function(project) {
      return matchesFilters_(project, config);
    });
    console.log('message:projects_matched id=%s count=%s', message.getId(), matchingProjects.length);

    if (matchingProjects.length > 0) {
      sendTelegramDigest_(matchingProjects, message, config);
    } else {
      console.log('message:no_matches id=%s', message.getId());
    }

    markGmailMessageProcessed_(message.getId(), processedLabelId);
    console.log('message:marked_processed id=%s labelId=%s', message.getId(), processedLabelId);
  });

  console.log('processKworkEmails:done');
}

function setupTrigger() {
  const handler = 'processKworkEmails';
  const triggers = ScriptApp.getProjectTriggers();
  const exists = triggers.some(function(trigger) {
    return trigger.getHandlerFunction() === handler;
  });

  if (!exists) {
    ScriptApp.newTrigger(handler).timeBased().everyMinutes(5).create();
  }
}

function saveConfig(config) {
  const properties = PropertiesService.getScriptProperties();
  Object.keys(config).forEach(function(key) {
    properties.setProperty(key, String(config[key]));
  });
}

function setDefaultConfig() {
  saveConfig({
    GMAIL_LABEL: CONFIG_DEFAULTS.gmailLabel,
    PROCESSED_LABEL: CONFIG_DEFAULTS.processedLabel,
    SEARCH_WINDOW_HOURS: CONFIG_DEFAULTS.searchWindowHours,
    MIN_BUDGET_RUB: CONFIG_DEFAULTS.minBudgetRub,
    MAX_BUDGET_RUB: CONFIG_DEFAULTS.maxBudgetRub,
    BUYER_HISTORY_FILTER_MODE: CONFIG_DEFAULTS.buyerHistoryFilterMode,
    MIN_BUYER_PROJECTS: CONFIG_DEFAULTS.minBuyerProjects,
    MIN_BUYER_HIRED_PERCENT: CONFIG_DEFAULTS.minBuyerHiredPercent,
    REQUIRED_KEYWORDS: CONFIG_DEFAULTS.requiredKeywords,
    EXCLUDED_KEYWORDS: CONFIG_DEFAULTS.excludedKeywords,
    TELEGRAM_PARSE_MODE: CONFIG_DEFAULTS.telegramParseMode,
    TELEGRAM_MESSAGE_DELAY_MS: CONFIG_DEFAULTS.telegramMessageDelayMs,
    TELEGRAM_MAX_RETRIES: CONFIG_DEFAULTS.telegramMaxRetries,
    MAX_MESSAGES_PER_RUN: CONFIG_DEFAULTS.maxMessagesPerRun
  });
}

function testTelegram() {
  const config = getConfig_();
  sendTelegramMessage_(
    [
      '<b>Kwork monitor connected</b>',
      '',
      'Test message from Google Apps Script.'
    ].join('\n'),
    config
  );
}

function debugKworkEmails() {
  const config = getConfig_();
  getOrCreateLabel_(config.gmailLabel);
  getOrCreateLabel_(config.processedLabel);
  const gmailLabelIds = getGmailLabelIdsByName_([config.gmailLabel, config.processedLabel]);
  const sourceLabelId = gmailLabelIds[config.gmailLabel];
  const processedLabelId = gmailLabelIds[config.processedLabel];
  console.log('debugKworkEmails:start label=%s sourceLabelId=%s processedLabel=%s processedLabelId=%s maxMessages=%s', config.gmailLabel, sourceLabelId, config.processedLabel, processedLabelId, config.maxMessagesPerRun);

  if (!sourceLabelId || !processedLabelId) {
    throw new Error('Required Gmail labels were not found through Gmail API.');
  }

  const candidates = listCandidateGmailMessages_(sourceLabelId, config);
  console.log('debug:candidates count=%s ids=%s', candidates.length, candidates.map(function(candidate) {
    return candidate.id;
  }).join(','));

  candidates.slice(0, 5).forEach(function(candidate) {
    const message = GmailApp.getMessageById(candidate.id);
    const htmlBody = message.getBody() || '';
    const newOfferCount = countMatches_(htmlBody, /new_offer\?project/g);
    const rows = extractProjectRows_(htmlBody);
    const projects = rows.map(function(rowHtml) {
      return parseProjectRow_(rowHtml, message.getDate());
    }).filter(function(project) {
      return !!project;
    });
    const matched = projects.filter(function(project) {
      return matchesFilters_(project, config);
    });

    console.log(
      'debug:message id=%s subject=%s date=%s htmlLength=%s newOfferCount=%s rows=%s projects=%s matched=%s firstTitle=%s',
      message.getId(),
      message.getSubject(),
      message.getDate(),
      htmlBody.length,
      newOfferCount,
      rows.length,
      projects.length,
      matched.length,
      projects[0] ? projects[0].title : ''
    );
  });

  console.log('debugKworkEmails:done');
}

function getConfig_() {
  const properties = PropertiesService.getScriptProperties();

  return {
    gmailLabel: properties.getProperty('GMAIL_LABEL') || CONFIG_DEFAULTS.gmailLabel,
    processedLabel: properties.getProperty('PROCESSED_LABEL') || CONFIG_DEFAULTS.processedLabel,
    searchWindowHours: Number(properties.getProperty('SEARCH_WINDOW_HOURS') || CONFIG_DEFAULTS.searchWindowHours),
    minBudgetRub: Number(properties.getProperty('MIN_BUDGET_RUB') || CONFIG_DEFAULTS.minBudgetRub),
    maxBudgetRub: Number(properties.getProperty('MAX_BUDGET_RUB') || CONFIG_DEFAULTS.maxBudgetRub),
    buyerHistoryFilterMode: normalizeBuyerHistoryFilterMode_(properties.getProperty('BUYER_HISTORY_FILTER_MODE') || CONFIG_DEFAULTS.buyerHistoryFilterMode),
    minBuyerProjects: Number(properties.getProperty('MIN_BUYER_PROJECTS') || CONFIG_DEFAULTS.minBuyerProjects),
    minBuyerHiredPercent: Number(properties.getProperty('MIN_BUYER_HIRED_PERCENT') || CONFIG_DEFAULTS.minBuyerHiredPercent),
    requiredKeywords: splitKeywords_(properties.getProperty('REQUIRED_KEYWORDS') || CONFIG_DEFAULTS.requiredKeywords),
    excludedKeywords: splitKeywords_(properties.getProperty('EXCLUDED_KEYWORDS') || CONFIG_DEFAULTS.excludedKeywords),
    telegramBotToken: properties.getProperty('TELEGRAM_BOT_TOKEN') || '',
    telegramChatId: properties.getProperty('TELEGRAM_CHAT_ID') || '',
    telegramParseMode: properties.getProperty('TELEGRAM_PARSE_MODE') || CONFIG_DEFAULTS.telegramParseMode,
    telegramMessageDelayMs: Number(properties.getProperty('TELEGRAM_MESSAGE_DELAY_MS') || CONFIG_DEFAULTS.telegramMessageDelayMs),
    telegramMaxRetries: Number(properties.getProperty('TELEGRAM_MAX_RETRIES') || CONFIG_DEFAULTS.telegramMaxRetries),
    maxMessagesPerRun: Number(properties.getProperty('MAX_MESSAGES_PER_RUN') || CONFIG_DEFAULTS.maxMessagesPerRun)
  };
}

function parseKworkProjectsFromMessage_(message, config) {
  const messageDate = message.getDate();
  const htmlBody = message.getBody() || '';
  const subject = String(message.getSubject() || '').toLowerCase();
  if (!htmlBody || subject.indexOf('kwork') === -1) {
    console.log('message:skip_non_kwork id=%s subject=%s html=%s', message.getId(), message.getSubject(), htmlBody ? 'yes' : 'no');
    return [];
  }

  const rows = extractProjectRows_(htmlBody);
  console.log('message:project_rows id=%s rows=%s', message.getId(), rows.length);
  return rows.map(function(rowHtml) {
    return parseProjectRow_(rowHtml, messageDate);
  }).filter(function(project) {
    return !!project;
  });
}

function extractProjectRows_(html) {
  const normalizedHtml = String(html || '')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ');
  const rowPattern = /<tr\b[^>]*>\s*<td\b[^>]*>\s*<div\b[^>]*>\s*<a\b[^>]+href=["']https:\/\/kwork\.ru\/new_offer\?project[^"']*["'][\s\S]*?<\/tr>/gi;
  const rows = normalizedHtml.match(rowPattern);
  return rows || [];
}

function parseProjectRow_(rowHtml, messageDate) {
  const cells = rowHtml.match(/<td\b[^>]*>[\s\S]*?<\/td>/gi);
  if (!cells || cells.length < 3) {
    console.log('project:skip_bad_row cells=%s', cells ? cells.length : 0);
    return null;
  }

  const projectLink = extractAttribute_(cells[0], /<a[^>]+href="([^"]+)"/i);
  const title = cleanText_(extractInnerHtml_(cells[0], /<a[^>]*>([\s\S]*?)<\/a>/i));
  const category = cleanText_(extractAllInnerHtml_(cells[0], /<div[^>]*>([\s\S]*?)<\/div>/gi).slice(1).join(' '));

  const buyerLink = extractAttribute_(cells[1], /<a[^>]+href="([^"]+)"/i);
  const buyerName = cleanText_(extractFirstBuyerName_(cells[1]));
  const buyerLevel = extractBuyerLevelValue_(cells[1]);
  const buyerStats = extractBuyerStats_(cells[1]);
  const buyerProjectsCount = extractBuyerProjectsCount_(buyerStats.projectsText);
  const buyerHiredPercent = extractBuyerHiredPercent_(buyerStats.hiredText);
  const budgetText = cleanText_(stripTags_(cells[2]));
  const budgetRub = extractBudgetRub_(budgetText);

  const normalizedText = normalizeText_([
    title,
    category,
    buyerName,
    buyerLevel,
    buyerStats.projectsText,
    buyerStats.hiredText,
    budgetText
  ].join(' '));

  return {
    title: title,
    category: category,
    url: projectLink,
    buyerName: buyerName,
    buyerLevel: buyerLevel,
    buyerUrl: buyerLink,
    buyerProjectsText: buyerStats.projectsText,
    buyerHiredText: buyerStats.hiredText,
    buyerProjectsCount: buyerProjectsCount,
    buyerHiredPercent: buyerHiredPercent,
    budgetText: budgetText,
    budgetRub: budgetRub,
    date: messageDate,
    normalizedText: normalizedText
  };
}

function extractFirstBuyerName_(html) {
  const spans = extractAllInnerHtml_(html, /<span\b[^>]*>([\s\S]*?)<\/span>/gi)
    .map(function(item) {
      return cleanText_(item);
    })
    .filter(function(item) {
      return item.length > 0;
    });

  return spans.length > 0 ? spans[spans.length - 1] : '';
}

function extractBuyerLevelValue_(html) {
  const levelBadgeMatch = String(html || '').match(/<div\b[^>]*border-radius\s*:\s*100%[^>]*>\s*([\s\S]*?)\s*<\/div>/i);
  if (levelBadgeMatch) {
    const badgeText = cleanText_(levelBadgeMatch[1]);
    if (/^\d+$/.test(badgeText)) {
      return badgeText;
    }
  }

  const attributeValues = [];
  String(html || '').replace(/\b(?:title|alt)=["']([^"']+)["']/gi, function(full, value) {
    attributeValues.push(cleanText_(value));
    return full;
  });

  const level = attributeValues.find(function(value) {
    return /уров|level|beginner|advanced|expert|pro/i.test(value);
  });

  if (level) {
    return level;
  }

  const text = cleanText_(html);
  const match = text.match(/(?:уровень|level)\s*[:\-]?\s*([^\|,;]+)/i);
  return match ? cleanText_(match[1]) : '';
}

function extractBuyerStats_(html) {
  const text = cleanText_(html);
  const projectsMatch = text.match(/(\d+)\s+(?:проект(?:ов|а)?\s+на\s+бирже|projects?\s+on\s+market)/i);
  const hiredMatch = text.match(/(\d+(?:[.,]\d+)?)\s*%\s*(?:наня|нанят|hired)/i);

  if (projectsMatch || hiredMatch) {
    return {
      projectsText: projectsMatch ? projectsMatch[0] : '',
      hiredText: hiredMatch ? hiredMatch[0] : ''
    };
  }

  const divs = extractAllInnerHtml_(html, /<div\b[^>]*>([\s\S]*?)<\/div>/gi)
    .map(function(item) {
      return cleanText_(item);
    })
    .filter(function(item) {
      return item.length > 0;
    });
  const projectsText = divs.find(function(item) {
    return /проект|project/i.test(item);
  }) || '';
  const hiredText = divs.find(function(item) {
    return /наня|hire|hired|%/i.test(item);
  }) || '';

  return {
    projectsText: projectsText,
    hiredText: hiredText
  };
}

function extractBuyerProjectsCount_(text) {
  const match = cleanText_(text).match(/\d+/);
  return match ? Number(match[0]) : null;
}

function extractBuyerHiredPercent_(text) {
  const match = cleanText_(text).match(/\d+(?:[.,]\d+)?\s*%/);
  return match ? Number(match[0].replace('%', '').replace(',', '.').replace(/\s+/g, '')) : null;
}

function normalizeBuyerHistoryFilterMode_(mode) {
  const normalized = String(mode || '').toLowerCase().trim();
  return ['off', 'mark', 'strict'].indexOf(normalized) !== -1 ? normalized : CONFIG_DEFAULTS.buyerHistoryFilterMode;
}

function evaluateBuyerHistory_(project, config) {
  const mode = normalizeBuyerHistoryFilterMode_(config.buyerHistoryFilterMode || CONFIG_DEFAULTS.buyerHistoryFilterMode);
  if (mode === 'off') {
    return {
      passes: true,
      warning: ''
    };
  }

  const minProjects = Number(config.minBuyerProjects || 0);
  const minHiredPercent = Number(config.minBuyerHiredPercent || 0);
  const hasProjects = project.buyerProjectsCount !== null && project.buyerProjectsCount !== undefined && !isNaN(project.buyerProjectsCount);
  const hasHired = project.buyerHiredPercent !== null && project.buyerHiredPercent !== undefined && !isNaN(project.buyerHiredPercent);

  if (!hasProjects && !hasHired) {
    return {
      passes: false,
      warning: '⚠ история заказчика не распознана'
    };
  }

  const reasons = [];
  if (minProjects > 0 && hasProjects && project.buyerProjectsCount < minProjects) {
    reasons.push('проектов ' + project.buyerProjectsCount + ' < ' + minProjects);
  }
  if (minHiredPercent > 0 && hasHired && project.buyerHiredPercent < minHiredPercent) {
    reasons.push('нанял ' + formatPercentForWarning_(project.buyerHiredPercent) + ' < ' + formatPercentForWarning_(minHiredPercent));
  }

  return {
    passes: reasons.length === 0,
    warning: reasons.length > 0 ? '⚠ ниже порога: ' + reasons.join(', ') : ''
  };
}

function formatPercentForWarning_(value) {
  return String(value).replace('.', ',') + '%';
}

function matchesFilters_(project, config) {
  if (!project.normalizedText) {
    console.log('project:skip_empty_text title=%s', project.title || '');
    return false;
  }

  if (config.minBudgetRub > 0 && project.budgetRub > 0 && project.budgetRub < config.minBudgetRub) {
    console.log('project:skip_min_budget title=%s budget=%s min=%s', project.title, project.budgetRub, config.minBudgetRub);
    return false;
  }

  if (config.maxBudgetRub > 0 && project.budgetRub > 0 && project.budgetRub > config.maxBudgetRub) {
    console.log('project:skip_max_budget title=%s budget=%s max=%s', project.title, project.budgetRub, config.maxBudgetRub);
    return false;
  }

  if (config.requiredKeywords.length > 0) {
    const hasRequired = config.requiredKeywords.some(function(keyword) {
      return project.normalizedText.indexOf(keyword) !== -1;
    });
    if (!hasRequired) {
      console.log('project:skip_required title=%s required=%s', project.title, config.requiredKeywords.join(','));
      return false;
    }
  }

  const hasExcluded = config.excludedKeywords.some(function(keyword) {
    return project.normalizedText.indexOf(keyword) !== -1;
  });
  if (hasExcluded) {
    console.log('project:skip_excluded title=%s excluded=%s', project.title, config.excludedKeywords.join(','));
    return false;
  }

  const buyerHistory = evaluateBuyerHistory_(project, config);
  if (!buyerHistory.passes) {
    if (normalizeBuyerHistoryFilterMode_(config.buyerHistoryFilterMode) === 'strict') {
      console.log('project:skip_buyer_history title=%s warning=%s', project.title, buyerHistory.warning || '');
      return false;
    }
    console.log('project:mark_buyer_history title=%s warning=%s', project.title, buyerHistory.warning || '');
  }

  console.log('project:match title=%s budget=%s buyer=%s', project.title, project.budgetRub, project.buyerName);
  return true;
}

function sendTelegramDigest_(projects, message, config) {
  console.log('telegram:digest_start messageId=%s projectCount=%s', message.getId(), projects.length);
  const header = [
    '<b>Дата:</b> ' + escapeHtml_(formatMessageDate_(message.getDate())),
    '<b>Заказов:</b> ' + projects.length
  ].join('\n');
  const separator = '\n\n---\n\n';
  const cards = projects.map(function(project) {
    return formatProjectCard_(project, config);
  });
  const digest = header + separator + cards.join(separator);

  console.log('telegram:digest_send messageId=%s length=%s', message.getId(), digest.length);
  if (digest.length > 4096) {
    console.log('telegram:digest_over_limit messageId=%s length=%s limit=4096', message.getId(), digest.length);
  }
  sendTelegramMessage_(digest, config);
  console.log('telegram:digest_done messageId=%s', message.getId());
}

function formatProjectCard_(project, config) {
  const budget = formatBudget_(project);
  const title = project.title || 'Без названия';
  const lines = ['<b>' + escapeHtml_(budget + ' | ' + title) + '</b>'];

  if (project.category) {
    lines.push(escapeHtml_(project.category));
  }

  if (project.buyerName) {
    let buyerLine = '<b>Заказчик:</b> ' + escapeHtml_(project.buyerName);
    if (project.buyerLevel) {
      buyerLine += ' | ' + escapeHtml_('ур. ' + project.buyerLevel);
    }
    lines.push(buyerLine);
  }

  const historyParts = [];
  if (project.buyerProjectsText) {
    historyParts.push('Проектов на бирже: ' + formatProjectsOnMarket_(project.buyerProjectsText));
  }
  if (project.buyerHiredText) {
    historyParts.push('Нанял: ' + formatHiredPercent_(project.buyerHiredText));
  }
  if (historyParts.length > 0) {
    lines.push('<b>История:</b> ' + escapeHtml_(historyParts.join(' | ')));
  }

  if (config) {
    const buyerHistory = evaluateBuyerHistory_(project, config);
    if (buyerHistory.warning) {
      lines.push(escapeHtml_(buyerHistory.warning));
    }
  }

  if (project.url) {
    lines.push('<a href="' + escapeHtml_(project.url) + '">Открыть заказ</a>');
  }

  return lines.join('\n');
}

function formatBudget_(project) {
  if (project.budgetRub > 0) {
    return String(project.budgetRub).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽';
  }

  return project.budgetText || 'Бюджет не указан';
}

function formatMessageDate_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'dd.MM.yyyy HH:mm');
}

function formatProjectsOnMarket_(text) {
  const value = cleanText_(text);
  const match = value.match(/\d+/);
  if (!match) {
    return value;
  }

  const projectsCount = Number(match[0]);
  return match[0] + formatProjectMarkers_(projectsCount);
}

function formatHiredPercent_(text) {
  const value = cleanText_(text);
  const percentMatch = value.match(/\d+(?:[.,]\d+)?\s*%/);
  if (percentMatch) {
    const percentText = percentMatch[0].replace(/\s+/g, '');
    const percentValue = Number(percentText.replace('%', '').replace(',', '.'));
    return percentText + formatFlames_(percentValue > 80 ? 1 : 0);
  }

  return value;
}

function formatFlames_(count) {
  if (count <= 0) {
    return '';
  }

  return ' ' + Array(count + 1).join('🔥');
}

function formatProjectMarkers_(projectsCount) {
  const partyCount = Math.floor(projectsCount / 1000);
  if (partyCount > 0) {
    return ' ' + Array(partyCount + 1).join('🎉');
  }

  return formatFlames_(Math.floor(projectsCount / 100));
}

function sendTelegramMessage_(text, config) {
  if (!config.telegramBotToken || !config.telegramChatId) {
    throw new Error('TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is not configured.');
  }

  const url = 'https://api.telegram.org/bot' + config.telegramBotToken + '/sendMessage';
  const payload = {
    chat_id: config.telegramChatId,
    text: text,
    parse_mode: config.telegramParseMode,
    disable_web_page_preview: true
  };

  const maxRetries = Math.max(1, config.telegramMaxRetries || 1);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    waitForTelegramRateLimit_(config);
    console.log('telegram:send_attempt attempt=%s length=%s chatId=%s', attempt, text.length, config.telegramChatId);

    const response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    lastTelegramSendAtMs_ = Date.now();

    const code = response.getResponseCode();
    if (code >= 200 && code < 300) {
      console.log('telegram:send_success attempt=%s code=%s', attempt, code);
      return;
    }

    const body = response.getContentText();
    const retryAfterSeconds = getTelegramRetryAfterSeconds_(body);
    if (code === 429 && retryAfterSeconds > 0 && attempt < maxRetries) {
      console.log('telegram:rate_limited attempt=%s retryAfter=%s', attempt, retryAfterSeconds);
      nextTelegramSendAtMs_ = Date.now() + (retryAfterSeconds * 1000) + 5000;
      waitForTelegramRateLimit_(config);
      continue;
    }

    console.log('telegram:send_error attempt=%s code=%s body=%s', attempt, code, body);
    throw new Error('Telegram API error: ' + code + ' ' + body);
  }
}

function waitForTelegramRateLimit_(config) {
  const delayMs = Math.max(0, config.telegramMessageDelayMs || 0);
  const baseNextSendAtMs = lastTelegramSendAtMs_ ? lastTelegramSendAtMs_ + delayMs : 0;
  const waitUntilMs = Math.max(baseNextSendAtMs, nextTelegramSendAtMs_);

  if (!waitUntilMs) {
    return;
  }

  const remainingMs = waitUntilMs - Date.now();
  if (remainingMs > 0) {
    console.log('telegram:wait ms=%s', remainingMs);
    Utilities.sleep(remainingMs);
  }
}

function getTelegramRetryAfterSeconds_(responseText) {
  try {
    const parsed = JSON.parse(responseText);
    return Number(parsed && parsed.parameters && parsed.parameters.retry_after) || 0;
  } catch (error) {
    return 0;
  }
}

function getOrCreateLabel_(name) {
  const existing = GmailApp.getUserLabelByName(name);
  return existing || GmailApp.createLabel(name);
}

function getGmailLabelIdsByName_(labelNames) {
  const result = {};
  const labelsResponse = Gmail.Users.Labels.list('me');
  const labels = labelsResponse.labels || [];

  labels.forEach(function(label) {
    if (labelNames.indexOf(label.name) !== -1) {
      result[label.name] = label.id;
    }
  });

  return result;
}

function listCandidateGmailMessages_(sourceLabelId, config) {
  const maxMessages = Math.max(1, Math.min(Number(config.maxMessagesPerRun) || CONFIG_DEFAULTS.maxMessagesPerRun, 100));
  const response = Gmail.Users.Messages.list('me', {
    labelIds: [sourceLabelId],
    q: '-label:' + config.processedLabel,
    maxResults: maxMessages,
    fields: 'messages/id,nextPageToken,resultSizeEstimate'
  });

  return response.messages || [];
}

function markGmailMessageProcessed_(messageId, processedLabelId) {
  Gmail.Users.Messages.modify(
    {
      addLabelIds: [processedLabelId]
    },
    'me',
    messageId
  );
}

function splitKeywords_(value) {
  return String(value)
    .split(',')
    .map(function(item) {
      return normalizeText_(item);
    })
    .filter(function(item) {
      return item.length > 0;
    });
}

function normalizeText_(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function countMatches_(text, pattern) {
  const matches = String(text || '').match(pattern);
  return matches ? matches.length : 0;
}

function extractBudgetRub_(text) {
  const numeric = String(text || '').replace(/[^\d]/g, '');
  return numeric ? Number(numeric) : 0;
}

function extractAttribute_(text, pattern) {
  const match = String(text || '').match(pattern);
  return match ? decodeHtmlEntities_(match[1]) : '';
}

function extractInnerHtml_(text, pattern) {
  const match = String(text || '').match(pattern);
  return match ? match[1] : '';
}

function extractAllInnerHtml_(text, pattern) {
  const results = [];
  String(text || '').replace(pattern, function(full, group) {
    results.push(group);
    return full;
  });
  return results;
}

function stripTags_(text) {
  return String(text || '').replace(/<[^>]+>/g, ' ');
}

function cleanText_(text) {
  return decodeHtmlEntities_(stripTags_(text))
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeHtmlEntities_(text) {
  return String(text || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function escapeHtml_(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
