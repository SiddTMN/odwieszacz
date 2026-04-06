const STORAGE_KEY = 'odwieszacz-reminders-v1';
const CHECKLIST_KEY = 'odwieszacz-checklist-v1';
const SETTINGS_KEY = 'odwieszacz-settings-v1';
const NOW_WINDOW_MINUTES = 15;
const checklistItems = ['telefon', 'klucze', 'portfel', 'dokumenty', 'leki'];
const DONE_RETENTION_DAYS = 7;
const DUE_CHECK_INTERVAL_MS = 15000;
const MAX_LATE_NOTIFICATION_MS = 6 * 60 * 60 * 1000;

const form = document.getElementById('reminder-form');
const titleInput = document.getElementById('title');
const noteInput = document.getElementById('note');
const dateInput = document.getElementById('date');
const timeInput = document.getElementById('time');
const recordButton = document.getElementById('record-button');
const recordingStatus = document.getElementById('recording-status');
const audioPreview = document.getElementById('audio-preview');
const template = document.getElementById('reminder-template');
const resetChecklistButton = document.getElementById('reset-checklist');
const showDoneButton = document.getElementById('show-done-button');
const hideDoneButton = document.getElementById('hide-done-button');
const clearOldDoneButton = document.getElementById('clear-old-done-button');
const donePanel = document.getElementById('done-panel');
const doneSummary = document.getElementById('done-summary');
const actionToast = document.getElementById('action-toast');
const notificationsPanel = document.getElementById('notifications-panel');
const notificationsText = document.getElementById('notifications-text');
const enableNotificationsButton = document.getElementById('enable-notifications-button');
const reminderAlert = document.getElementById('reminder-alert');
const reminderAlertTitle = document.getElementById('reminder-alert-title');
const reminderAlertNote = document.getElementById('reminder-alert-note');
const alertDoneButton = document.getElementById('alert-done-button');
const alertSnooze5Button = document.getElementById('alert-snooze-5-button');
const alertSnooze15Button = document.getElementById('alert-snooze-15-button');
const alertSnooze60Button = document.getElementById('alert-snooze-60-button');

const listNow = document.getElementById('list-now');
const listToday = document.getElementById('list-today');
const listOverdue = document.getElementById('list-overdue');
const listDone = document.getElementById('list-done');
const checklistRoot = document.getElementById('checklist');

let reminders = loadReminders();
let checklistState = loadChecklistState();
let settings = loadSettings();
let mediaRecorder = null;
let recordedChunks = [];
let currentAudioDataUrl = '';
let toastTimeoutId = null;
let dueCheckIntervalId = null;
let alertQueue = [];
let currentAlertReminderId = null;

initializeApp();

function initializeApp() {
  ensureSampleData();
  applyDefaultDateTime();
  bindEvents();
  bindButtonPressFeedback();
  restoreDonePanelState();
  renderNotificationPermissionUI();
  registerServiceWorker();
  bindServiceWorkerMessages();
  renderAll();
  handleNotificationActionFromQuery();
  startDueReminderWatcher();
}

function bindEvents() {
  form.addEventListener('submit', handleSubmit);
  recordButton.addEventListener('click', toggleRecording);
  resetChecklistButton.addEventListener('click', resetChecklist);
  showDoneButton.addEventListener('click', showDonePanel);
  hideDoneButton.addEventListener('click', hideDonePanel);
  clearOldDoneButton.addEventListener('click', clearOldDoneReminders);
  enableNotificationsButton.addEventListener('click', requestNotificationPermissionFromUser);
  alertDoneButton.addEventListener('click', () => applyAlertAction('done'));
  alertSnooze5Button.addEventListener('click', () => applyAlertAction('snooze5'));
  alertSnooze15Button.addEventListener('click', () => applyAlertAction('snooze15'));
  alertSnooze60Button.addEventListener('click', () => applyAlertAction('snooze60'));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      checkDueReminders();
    }
  });
}

function handleSubmit(event) {
  event.preventDefault();

  const dueAt = buildDueAt(dateInput.value, timeInput.value);
  const title = titleInput.value.trim();

  if (!title) {
    alert('Wpisz tytuł przypomnienia.');
    return;
  }

  if (!dueAt) {
    alert('Wybierz poprawną datę i godzinę.');
    return;
  }

  const reminder = {
    id: createId(),
    title,
    note: noteInput.value.trim(),
    dueAt,
    createdAt: new Date().toISOString(),
    completedAt: null,
    status: 'active',
    audioDataUrl: currentAudioDataUrl || ''
  };

  reminders.unshift(reminder);
  persistReminders();
  renderAll();
  resetFormState();
  showToast('Zapisano', 'success');
  remindAboutNotificationsIfNeeded();
  checkDueReminders();
}

async function toggleRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    return;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') {
    alert('Ta przeglądarka nie obsługuje nagrywania mikrofonu.');
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordedChunks = [];
    mediaRecorder = new MediaRecorder(stream);

    mediaRecorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    });

    mediaRecorder.addEventListener('stop', async () => {
      const blob = new Blob(recordedChunks, { type: 'audio/webm' });
      currentAudioDataUrl = await blobToDataUrl(blob);
      audioPreview.src = currentAudioDataUrl;
      audioPreview.hidden = false;
      setRecordingIdle('Nagranie gotowe');
      showToast('Nagranie gotowe', 'success');
      stream.getTracks().forEach((track) => track.stop());
    }, { once: true });

    mediaRecorder.start();
    recordButton.classList.add('recording');
    recordButton.textContent = 'Zakończ nagrywanie';
    recordingStatus.textContent = 'Nagrywanie trwa';
  } catch (error) {
    console.error(error);
    alert('Nie udało się uruchomić mikrofonu. Sprawdź uprawnienia przeglądarki.');
  }
}

function resetChecklist() {
  checklistState = Object.fromEntries(checklistItems.map((item) => [item, false]));
  persistChecklistState();
  renderChecklist();
  showToast('Checklista wyczyszczona');
}

function showDonePanel() {
  settings.showDonePanel = true;
  persistSettings();
  restoreDonePanelState();
  renderDoneList();
  showToast('Otwarto Zrobione');
}

function hideDonePanel() {
  settings.showDonePanel = false;
  persistSettings();
  restoreDonePanelState();
  showToast('Ukryto Zrobione');
}

function restoreDonePanelState() {
  donePanel.hidden = !settings.showDonePanel;
  showDoneButton.textContent = settings.showDonePanel ? 'Zrobione otwarte' : 'Pokaż zrobione';
  showDoneButton.disabled = settings.showDonePanel;
}

function renderAll() {
  renderReminderGroups();
  renderDoneList();
  renderChecklist();
}

function renderReminderGroups() {
  const activeReminders = reminders
    .filter((item) => item.status === 'active')
    .sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt));

  const now = new Date();
  const todayKey = getDateKey(now);
  const groups = {
    now: [],
    today: [],
    overdue: []
  };

  for (const reminder of activeReminders) {
    const dueDate = new Date(reminder.dueAt);
    const diffMinutes = (dueDate - now) / 60000;
    const reminderDateKey = getDateKey(dueDate);

    if (diffMinutes < 0) {
      groups.overdue.push(reminder);
    } else if (diffMinutes <= NOW_WINDOW_MINUTES) {
      groups.now.push(reminder);
    } else if (reminderDateKey === todayKey) {
      groups.today.push(reminder);
    }
  }

  renderReminderList(listNow, groups.now, 'Brak pilnych przypomnień.');
  renderReminderList(listToday, groups.today, 'Na dziś nic więcej nie ma.');
  renderReminderList(listOverdue, groups.overdue, 'Brak spóźnionych przypomnień.');
}

function renderDoneList() {
  const doneReminders = reminders
    .filter((item) => item.status === 'done')
    .sort((a, b) => new Date(b.completedAt || b.createdAt) - new Date(a.completedAt || a.createdAt));

  updateDoneSummary(doneReminders);
  renderReminderList(listDone, doneReminders, 'Brak zakończonych przypomnień.');
}

function renderReminderList(root, items, emptyText) {
  root.innerHTML = '';

  if (items.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = emptyText;
    root.appendChild(empty);
    return;
  }

  for (const reminder of items) {
    const node = template.content.firstElementChild.cloneNode(true);
    const titleNode = node.querySelector('.reminder-title');
    const noteNode = node.querySelector('.note-row');
    const statusNode = node.querySelector('.status-text');
    const scheduleNode = node.querySelector('.schedule-row');
    const audioPlayer = node.querySelector('.audio-player');
    const playButton = node.querySelector('.play-button');
    const doneButton = node.querySelector('.done-button');
    const snoozeButton = node.querySelector('.snooze-button');
    const deleteButton = node.querySelector('.delete-button');
    const statusInfo = classifyStatus(reminder);

    titleNode.textContent = reminder.title;
    noteNode.innerHTML = reminder.note ? `<strong>Notatka:</strong> ${escapeHtml(reminder.note)}` : '<strong>Notatka:</strong> brak';
    statusNode.textContent = statusInfo.label;
    scheduleNode.innerHTML = buildScheduleText(reminder);

    if (statusInfo.className) {
      node.classList.add(statusInfo.className);
    }

    if (reminder.audioDataUrl) {
      audioPlayer.src = reminder.audioDataUrl;
      playButton.addEventListener('click', () => {
        audioPlayer.hidden = false;
        audioPlayer.play().catch(() => {});
      });
    } else {
      playButton.disabled = true;
      playButton.textContent = 'Brak nagrania';
    }

    if (reminder.status === 'done') {
      doneButton.textContent = 'Przywróć';
      doneButton.addEventListener('click', () => {
        updateReminder(reminder.id, {
          status: 'active',
          completedAt: null,
          lastNotifiedDueAt: null
        });
        showToast('Przywrócono', 'success');
      });
      snoozeButton.disabled = true;
      snoozeButton.textContent = 'Zakończone';
    } else {
      doneButton.addEventListener('click', () => {
        markReminderDone(reminder.id);
      });
      snoozeButton.addEventListener('click', () => {
        snoozeReminder(reminder.id, 5);
      });
    }

    deleteButton.addEventListener('click', () => {
      deleteReminder(reminder.id);
      showToast('Usunięto', 'danger');
    });

    root.appendChild(node);
  }
}

function renderChecklist() {
  checklistRoot.innerHTML = '';

  checklistItems.forEach((item) => {
    const label = document.createElement('label');
    label.className = 'check-item';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = Boolean(checklistState[item]);
    input.addEventListener('change', () => {
      checklistState[item] = input.checked;
      persistChecklistState();
    });

    const text = document.createElement('span');
    text.textContent = item;

    label.append(input, text);
    checklistRoot.appendChild(label);
  });
}

function classifyStatus(reminder) {
  const dueDate = new Date(reminder.dueAt);
  const diffMinutes = (dueDate - new Date()) / 60000;

  if (reminder.status === 'done') {
    return { label: 'zrobione', className: 'done' };
  }
  if (diffMinutes < 0) {
    return { label: 'spóźnione', className: 'overdue' };
  }
  if (diffMinutes <= NOW_WINDOW_MINUTES) {
    return { label: 'na teraz', className: 'now' };
  }
  return { label: 'aktywne', className: '' };
}

function updateReminder(id, changes) {
  reminders = reminders.map((item) => {
    if (item.id !== id) {
      return item;
    }

    const merged = { ...item, ...changes };
    if (Object.prototype.hasOwnProperty.call(changes, 'dueAt') && changes.dueAt !== item.dueAt) {
      merged.lastNotifiedDueAt = null;
    }
    return merged;
  });

  persistReminders();
  renderAll();
  checkDueReminders();
}

function deleteReminder(id) {
  reminders = reminders.filter((item) => item.id !== id);
  persistReminders();
  renderAll();
}

function clearOldDoneReminders() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - DONE_RETENTION_DAYS);

  const originalLength = reminders.length;
  reminders = reminders.filter((item) => {
    if (item.status !== 'done') {
      return true;
    }

    const completedAt = item.completedAt ? new Date(item.completedAt) : new Date(item.createdAt);
    return completedAt >= cutoff;
  });

  if (reminders.length === originalLength) {
    showToast('Nie ma starych zakończonych', 'warning');
    return;
  }

  persistReminders();
  renderAll();
  showToast('Usunięto stare zakończone', 'danger');
}

function loadReminders() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persistReminders() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(reminders));
}

function loadChecklistState() {
  try {
    const raw = localStorage.getItem(CHECKLIST_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return Object.fromEntries(checklistItems.map((item) => [item, Boolean(parsed[item])])) ;
  } catch {
    return Object.fromEntries(checklistItems.map((item) => [item, false]));
  }
}

function persistChecklistState() {
  localStorage.setItem(CHECKLIST_KEY, JSON.stringify(checklistState));
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      showDonePanel: Boolean(parsed.showDonePanel)
    };
  } catch {
    return {
      showDonePanel: false
    };
  }
}

function persistSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function ensureSampleData() {
  if (reminders.length > 0) {
    return;
  }

  const now = new Date();
  const in10Min = new Date(now.getTime() + 10 * 60000);
  const in2Hours = new Date(now.getTime() + 120 * 60000);
  const overdue = new Date(now.getTime() - 25 * 60000);

  reminders = [
    {
      id: createId(),
      title: 'Wypij wodę',
      note: 'Szklanka stoi w kuchni.',
      dueAt: in10Min.toISOString(),
      createdAt: now.toISOString(),
      completedAt: null,
      status: 'active',
      audioDataUrl: ''
    },
    {
      id: createId(),
      title: 'Telefon do córki',
      note: 'Zapytaj o wizytę w sobotę.',
      dueAt: in2Hours.toISOString(),
      createdAt: now.toISOString(),
      completedAt: null,
      status: 'active',
      audioDataUrl: ''
    },
    {
      id: createId(),
      title: 'Weź leki',
      note: 'Tabletki są przy czajniku.',
      dueAt: overdue.toISOString(),
      createdAt: now.toISOString(),
      completedAt: null,
      status: 'active',
      audioDataUrl: ''
    }
  ];

  persistReminders();
}

function applyDefaultDateTime() {
  const next = new Date();
  next.setMinutes(next.getMinutes() + 30);
  dateInput.value = getDateKey(next);
  timeInput.value = `${String(next.getHours()).padStart(2, '0')}:${String(next.getMinutes()).padStart(2, '0')}`;
}

function resetFormState() {
  form.reset();
  currentAudioDataUrl = '';
  audioPreview.hidden = true;
  audioPreview.removeAttribute('src');
  applyDefaultDateTime();
  setRecordingIdle('Przypomnienie zapisane');
  titleInput.focus();
}

function buildDueAt(dateValue, timeValue) {
  if (!dateValue || !timeValue) {
    return '';
  }

  const combined = new Date(`${dateValue}T${timeValue}`);
  return Number.isNaN(combined.getTime()) ? '' : combined.toISOString();
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat('pl-PL', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));
}

function getDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function setRecordingIdle(message) {
  recordButton.classList.remove('recording');
  recordButton.textContent = 'Nagraj przypomnienie';
  recordingStatus.textContent = message;
}

function bindButtonPressFeedback() {
  const clearPressed = (button) => {
    if (button) {
      button.classList.remove('is-pressed');
    }
  };

  document.addEventListener('pointerdown', (event) => {
    const button = event.target.closest('button');
    if (!button || button.disabled) {
      return;
    }
    button.classList.add('is-pressed');
  });

  document.addEventListener('pointerup', (event) => {
    clearPressed(event.target.closest('button'));
  });

  document.addEventListener('pointercancel', (event) => {
    clearPressed(event.target.closest('button'));
  });

  document.addEventListener('pointerleave', (event) => {
    clearPressed(event.target.closest('button'));
  }, true);
}

function updateDoneSummary(doneReminders) {
  const count = doneReminders.length;
  const oldCount = doneReminders.filter((item) => isOldDoneReminder(item)).length;

  doneSummary.textContent = count === 0
    ? 'Brak zakończonych przypomnień.'
    : `Zakończone: ${count}. Starsze niż ${DONE_RETENTION_DAYS} dni: ${oldCount}.`;

  clearOldDoneButton.disabled = oldCount === 0;
}

function isOldDoneReminder(reminder) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - DONE_RETENTION_DAYS);
  const completedAt = reminder.completedAt ? new Date(reminder.completedAt) : new Date(reminder.createdAt);
  return completedAt < cutoff;
}

function buildScheduleText(reminder) {
  const dueText = `<strong>Termin:</strong> ${formatDateTime(reminder.dueAt)}`;

  if (reminder.status !== 'done' || !reminder.completedAt) {
    return dueText;
  }

  return `${dueText}<br><strong>Zakończone:</strong> ${formatDateTime(reminder.completedAt)}`;
}

function showToast(message, variant = 'neutral') {
  if (!actionToast) {
    return;
  }

  actionToast.textContent = message;
  actionToast.className = `action-toast ${variant}`;
  actionToast.hidden = false;

  if (toastTimeoutId) {
    clearTimeout(toastTimeoutId);
  }

  toastTimeoutId = window.setTimeout(() => {
    actionToast.hidden = true;
  }, 1800);
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function createId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return `reminder-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function markReminderDone(reminderId, showFeedback = true) {
  updateReminder(reminderId, {
    status: 'done',
    completedAt: new Date().toISOString()
  });

  if (showFeedback) {
    showToast('Oznaczono jako zrobione', 'success');
  }
}

function snoozeReminder(reminderId, minutes, showFeedback = true) {
  const nextTime = new Date();
  nextTime.setMinutes(nextTime.getMinutes() + minutes);
  updateReminder(reminderId, { dueAt: nextTime.toISOString() });

  if (showFeedback) {
    showToast(`Odłożono o ${formatSnoozeLabel(minutes)}`, 'warning');
  }
}

function formatSnoozeLabel(minutes) {
  if (minutes === 60) {
    return '1 godz.';
  }
  return `${minutes} min`;
}

function renderNotificationPermissionUI() {
  if (!notificationsPanel || !notificationsText || !enableNotificationsButton) {
    return;
  }

  if (!('Notification' in window)) {
    notificationsPanel.hidden = false;
    notificationsText.textContent = 'Ta przeglądarka nie wspiera powiadomień.';
    enableNotificationsButton.hidden = true;
    return;
  }

  notificationsPanel.hidden = false;

  if (Notification.permission === 'granted') {
    notificationsText.textContent = 'Powiadomienia są włączone.';
    enableNotificationsButton.hidden = true;
    return;
  }

  if (Notification.permission === 'denied') {
    notificationsText.textContent = 'Powiadomienia są zablokowane. Włącz je w ustawieniach przeglądarki.';
    enableNotificationsButton.hidden = true;
    return;
  }

  notificationsText.textContent = 'Włącz powiadomienia, żeby przypomnienia były bardziej widoczne.';
  enableNotificationsButton.hidden = false;
}

function remindAboutNotificationsIfNeeded() {
  if (!('Notification' in window)) {
    return;
  }

  if (Notification.permission === 'default') {
    renderNotificationPermissionUI();
  }
}

async function requestNotificationPermissionFromUser() {
  if (!('Notification' in window)) {
    showToast('Brak wsparcia dla powiadomień', 'warning');
    return;
  }

  try {
    const permission = await Notification.requestPermission();
    renderNotificationPermissionUI();

    if (permission === 'granted') {
      showToast('Powiadomienia włączone', 'success');
      checkDueReminders();
      return;
    }

    if (permission === 'denied') {
      showToast('Powiadomienia zablokowane', 'warning');
    }
  } catch {
    showToast('Nie udało się włączyć powiadomień', 'danger');
  }
}

function startDueReminderWatcher() {
  checkDueReminders();

  if (dueCheckIntervalId) {
    clearInterval(dueCheckIntervalId);
  }

  dueCheckIntervalId = window.setInterval(() => {
    checkDueReminders();
  }, DUE_CHECK_INTERVAL_MS);
}

function checkDueReminders() {
  const now = Date.now();
  const dueReminders = reminders.filter((item) => {
    if (item.status !== 'active') {
      return false;
    }

    const dueMs = new Date(item.dueAt).getTime();
    if (Number.isNaN(dueMs) || dueMs > now) {
      return false;
    }

    if (item.lastNotifiedDueAt === item.dueAt) {
      return false;
    }

    return now - dueMs <= MAX_LATE_NOTIFICATION_MS;
  });

  if (dueReminders.length === 0) {
    return;
  }

  dueReminders.forEach((reminder) => {
    triggerReminder(reminder);
  });
}

function triggerReminder(reminder) {
  markReminderAsNotified(reminder.id, reminder.dueAt);
  queueReminderAlert(reminder.id);
  showBrowserNotification(reminder).catch(() => {});
}

function markReminderAsNotified(reminderId, dueAtValue) {
  reminders = reminders.map((item) => {
    if (item.id !== reminderId) {
      return item;
    }
    return {
      ...item,
      lastNotifiedDueAt: dueAtValue
    };
  });

  persistReminders();
  renderAll();
}

function queueReminderAlert(reminderId) {
  if (currentAlertReminderId === reminderId || alertQueue.includes(reminderId)) {
    return;
  }

  alertQueue.push(reminderId);
  showNextReminderAlert();
}

function showNextReminderAlert() {
  if (currentAlertReminderId || alertQueue.length === 0) {
    return;
  }

  const nextId = alertQueue.shift();
  const reminder = reminders.find((item) => item.id === nextId && item.status === 'active');

  if (!reminder) {
    showNextReminderAlert();
    return;
  }

  currentAlertReminderId = reminder.id;
  reminderAlertTitle.textContent = `Przypomnienie: ${reminder.title}`;
  reminderAlertNote.textContent = reminder.note || 'Bez dodatkowej notatki.';
  reminderAlert.hidden = false;
}

function applyAlertAction(action) {
  if (!currentAlertReminderId) {
    return;
  }

  const reminderId = currentAlertReminderId;
  currentAlertReminderId = null;
  reminderAlert.hidden = true;

  if (action === 'done') {
    markReminderDone(reminderId);
    showNextReminderAlert();
    return;
  }

  if (action === 'snooze5') {
    snoozeReminder(reminderId, 5);
    showNextReminderAlert();
    return;
  }

  if (action === 'snooze15') {
    snoozeReminder(reminderId, 15);
    showNextReminderAlert();
    return;
  }

  if (action === 'snooze60') {
    snoozeReminder(reminderId, 60);
    showNextReminderAlert();
  }
}

async function showBrowserNotification(reminder) {
  if (!('Notification' in window) || Notification.permission !== 'granted') {
    return;
  }

  const options = {
    body: reminder.note || `Termin: ${formatDateTime(reminder.dueAt)}`,
    tag: `reminder-${reminder.id}`,
    requireInteraction: true,
    data: {
      reminderId: reminder.id
    },
    actions: [
      { action: 'done', title: 'Zrobione' },
      { action: 'snooze5', title: 'Odłóż 5 min' },
      { action: 'snooze15', title: 'Odłóż 15 min' },
      { action: 'snooze60', title: 'Odłóż 1 godz.' }
    ]
  };

  const swRegistration = await navigator.serviceWorker.getRegistration();
  if (swRegistration && typeof swRegistration.showNotification === 'function') {
    await swRegistration.showNotification(reminder.title, options);
    return;
  }

  const fallback = new Notification(reminder.title, options);
  fallback.addEventListener('click', () => {
    window.focus();
    queueReminderAlert(reminder.id);
  });
}

function bindServiceWorkerMessages() {
  if (!('serviceWorker' in navigator)) {
    return;
  }

  navigator.serviceWorker.addEventListener('message', (event) => {
    const data = event.data || {};
    if (data.type !== 'notification-action') {
      return;
    }

    processNotificationAction(data.action, data.reminderId);
  });
}

function handleNotificationActionFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const action = params.get('notificationAction');
  const reminderId = params.get('reminderId');

  if (!action || !reminderId) {
    return;
  }

  processNotificationAction(action, reminderId);
  params.delete('notificationAction');
  params.delete('reminderId');
  const newQuery = params.toString();
  const nextUrl = `${window.location.pathname}${newQuery ? `?${newQuery}` : ''}${window.location.hash}`;
  window.history.replaceState({}, '', nextUrl);
}

function processNotificationAction(action, reminderId) {
  const reminder = reminders.find((item) => item.id === reminderId);
  if (!reminder || reminder.status !== 'active') {
    return;
  }

  if (action === 'done') {
    markReminderDone(reminderId, false);
    showToast('Zrobione z powiadomienia', 'success');
    return;
  }

  if (action === 'snooze5') {
    snoozeReminder(reminderId, 5, false);
    showToast('Odłożono o 5 min', 'warning');
    return;
  }

  if (action === 'snooze15') {
    snoozeReminder(reminderId, 15, false);
    showToast('Odłożono o 15 min', 'warning');
    return;
  }

  if (action === 'snooze60') {
    snoozeReminder(reminderId, 60, false);
    showToast('Odłożono o 1 godz.', 'warning');
    return;
  }

  queueReminderAlert(reminderId);
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    return;
  }

  try {
    await navigator.serviceWorker.register('service-worker.js');
  } catch (error) {
    console.warn('Nie udało się zarejestrować service workera.', error);
  }
}
