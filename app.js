const REMINDERS_KEY = 'odwieszacz-reminders-v1';
const VOICE_NOTES_KEY = 'odwieszacz-voice-notes-v1';
const SETTINGS_KEY = 'odwieszacz-settings-v1';
const DONE_RETENTION_DAYS = 7;
const DUE_CHECK_INTERVAL_MS = 20000;
const MAX_LATE_NOTIFICATION_MS = 6 * 60 * 60 * 1000;

const form = document.getElementById('reminder-form');
const titleInput = document.getElementById('title');
const noteInput = document.getElementById('note');
const dateInput = document.getElementById('date');
const timeInput = document.getElementById('time');
const recordButton = document.getElementById('record-button');
const recordingStatus = document.getElementById('recording-status');
const latestNotePreview = document.getElementById('latest-note-preview');
const feedbackBanner = document.getElementById('feedback-banner');
const notificationsPanel = document.getElementById('notifications-panel');
const notificationsText = document.getElementById('notifications-text');
const enableNotificationsButton = document.getElementById('enable-notifications-button');
const toggleDoneButton = document.getElementById('toggle-done-button');
const clearOldDoneButton = document.getElementById('clear-old-done-button');
const activeCount = document.getElementById('active-count');
const voiceNoteCount = document.getElementById('voice-note-count');
const activeRemindersRoot = document.getElementById('active-reminders');
const donePanel = document.getElementById('done-panel');
const doneSummary = document.getElementById('done-summary');
const doneRemindersRoot = document.getElementById('done-reminders');
const voiceNotesRoot = document.getElementById('voice-notes-list');
const reminderTemplate = document.getElementById('reminder-template');
const voiceNoteTemplate = document.getElementById('voice-note-template');

let reminders = loadReminders();
let voiceNotes = loadVoiceNotes();
let settings = loadSettings();
let mediaRecorder = null;
let mediaStream = null;
let recordedChunks = [];
let feedbackTimeoutId = null;
let dueCheckIntervalId = null;

initializeApp();

function initializeApp() {
  applyDefaultDateTime();
  bindEvents();
  bindButtonPressFeedback();
  renderNotificationPermissionUI();
  registerServiceWorker();
  renderAll();
  startDueReminderWatcher();
}

function bindEvents() {
  form.addEventListener('submit', handleSubmit);
  recordButton.addEventListener('click', toggleRecording);
  enableNotificationsButton.addEventListener('click', requestNotificationPermissionFromUser);
  toggleDoneButton.addEventListener('click', toggleDonePanel);
  clearOldDoneButton.addEventListener('click', clearOldDoneReminders);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      checkDueReminders();
      renderReminderLists();
    }
  });
}

function handleSubmit(event) {
  event.preventDefault();

  const title = titleInput.value.trim();
  const dueAt = buildDueAt(dateInput.value, timeInput.value);

  if (!title) {
    showFeedback('Wpisz, co trzeba zrobic.', 'warning', true);
    titleInput.focus();
    return;
  }

  if (!dueAt) {
    showFeedback('Wybierz poprawna date i godzine.', 'warning', true);
    return;
  }

  reminders.unshift({
    id: createId(),
    title,
    note: noteInput.value.trim(),
    dueAt,
    createdAt: new Date().toISOString(),
    completedAt: null,
    status: 'active',
    lastNotifiedDueAt: null
  });

  persistReminders();
  resetReminderForm();
  renderAll();
  showFeedback('Przypomnienie zapisane.', 'success');
  remindAboutNotificationsIfNeeded();
  checkDueReminders();
}

async function toggleRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    return;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') {
    showFeedback('Ta przegladarka nie obsluguje nagrywania.', 'danger', true);
    return;
  }

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordedChunks = [];
    mediaRecorder = new MediaRecorder(mediaStream);

    mediaRecorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    });

    mediaRecorder.addEventListener('stop', handleRecordingStop, { once: true });
    mediaRecorder.start();
    recordButton.classList.add('recording');
    recordButton.textContent = 'Zatrzymaj i zapisz';
    recordingStatus.textContent = 'Nagrywanie trwa';
    showFeedback('Nagrywanie wlaczone.', 'neutral');
  } catch (error) {
    console.error(error);
    stopMediaStream();
    showFeedback('Nie udalo sie uruchomic mikrofonu.', 'danger', true);
  }
}

async function handleRecordingStop() {
  recordButton.classList.remove('recording');
  recordButton.textContent = 'Nagraj notatke';

  try {
    if (recordedChunks.length === 0) {
      recordingStatus.textContent = 'Brak nagrania';
      showFeedback('Nagranie jest puste.', 'warning');
      return;
    }

    const blob = new Blob(recordedChunks, { type: 'audio/webm' });
    const dataUrl = await blobToDataUrl(blob);
    const note = {
      id: createId(),
      createdAt: new Date().toISOString(),
      audioDataUrl: dataUrl
    };

    voiceNotes.unshift(note);
    persistVoiceNotes();
    latestNotePreview.src = dataUrl;
    latestNotePreview.hidden = false;
    recordingStatus.textContent = 'Notatka zapisana';
    renderVoiceNotes();
    showFeedback('Notatka glosowa zapisana.', 'success');
  } catch (error) {
    console.error(error);
    recordingStatus.textContent = 'Blad zapisu';
    showFeedback('Nie udalo sie zapisac nagrania.', 'danger', true);
  } finally {
    recordedChunks = [];
    mediaRecorder = null;
    stopMediaStream();
  }
}

function stopMediaStream() {
  if (!mediaStream) {
    return;
  }

  mediaStream.getTracks().forEach((track) => track.stop());
  mediaStream = null;
}

function renderAll() {
  renderReminderLists();
  renderVoiceNotes();
  renderDonePanelState();
}

function renderReminderLists() {
  const activeReminders = reminders
    .filter((item) => item.status === 'active')
    .sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt));
  const doneReminders = reminders
    .filter((item) => item.status === 'done')
    .sort((a, b) => new Date(b.completedAt || b.createdAt) - new Date(a.completedAt || a.createdAt));

  activeCount.textContent = String(activeReminders.length);
  renderReminderList(activeRemindersRoot, activeReminders, false, 'Brak aktywnych przypomnien.');
  renderReminderList(doneRemindersRoot, doneReminders, true, 'Brak zakonczonych przypomnien.');
  updateDoneSummary(doneReminders);
}

function renderReminderList(root, items, isDoneList, emptyText) {
  root.innerHTML = '';

  if (items.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = emptyText;
    root.appendChild(empty);
    return;
  }

  for (const reminder of items) {
    const node = reminderTemplate.content.firstElementChild.cloneNode(true);
    const titleNode = node.querySelector('.reminder-title');
    const timeNode = node.querySelector('.reminder-time');
    const noteNode = node.querySelector('.reminder-note');
    const doneButton = node.querySelector('.done-button');
    const snoozeButton = node.querySelector('.snooze-button');
    const deleteButton = node.querySelector('.delete-button');

    titleNode.textContent = reminder.title;
    timeNode.textContent = formatReminderTime(reminder, isDoneList);
    applyReminderTone(node, reminder);

    if (reminder.note) {
      noteNode.hidden = false;
      noteNode.textContent = reminder.note;
    }

    if (isDoneList) {
      doneButton.textContent = 'Przywroc';
      doneButton.addEventListener('click', () => restoreReminder(reminder.id));
      snoozeButton.hidden = true;
    } else {
      doneButton.addEventListener('click', () => markReminderDone(reminder.id));
      snoozeButton.addEventListener('click', () => snoozeReminder(reminder.id, 10));
    }

    deleteButton.addEventListener('click', () => deleteReminder(reminder.id));
    root.appendChild(node);
  }
}

function renderVoiceNotes() {
  voiceNotesRoot.innerHTML = '';
  voiceNoteCount.textContent = String(voiceNotes.length);

  if (voiceNotes.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'Brak szybkich notatek glosowych.';
    voiceNotesRoot.appendChild(empty);
    return;
  }

  for (const note of voiceNotes) {
    const node = voiceNoteTemplate.content.firstElementChild.cloneNode(true);
    const titleNode = node.querySelector('.voice-note-title');
    const timeNode = node.querySelector('.voice-note-time');
    const audioNode = node.querySelector('.voice-note-audio');
    const deleteButton = node.querySelector('.note-delete-button');

    titleNode.textContent = `Notatka ${formatDateTime(note.createdAt)}`;
    timeNode.textContent = 'Zapisano lokalnie w tej przegladarce.';
    audioNode.src = note.audioDataUrl;
    deleteButton.addEventListener('click', () => deleteVoiceNote(note.id));

    voiceNotesRoot.appendChild(node);
  }
}

function renderDonePanelState() {
  donePanel.hidden = !settings.showDonePanel;
  toggleDoneButton.textContent = settings.showDonePanel ? 'Ukryj zrobione' : 'Pokaz zrobione';
}

function updateDoneSummary(doneReminders) {
  const oldCount = doneReminders.filter((item) => isOldDoneReminder(item)).length;

  if (doneReminders.length === 0) {
    doneSummary.textContent = 'Tutaj trafiaja zakonczone przypomnienia.';
  } else {
    doneSummary.textContent = `Zakonczone: ${doneReminders.length}. Stare wpisy starsze niz ${DONE_RETENTION_DAYS} dni: ${oldCount}.`;
  }

  clearOldDoneButton.disabled = oldCount === 0;
}

function toggleDonePanel() {
  settings.showDonePanel = !settings.showDonePanel;
  persistSettings();
  renderDonePanelState();
}

function markReminderDone(reminderId) {
  updateReminder(reminderId, {
    status: 'done',
    completedAt: new Date().toISOString()
  });
  showFeedback('Przypomnienie oznaczone jako zrobione.', 'success');
}

function restoreReminder(reminderId) {
  updateReminder(reminderId, {
    status: 'active',
    completedAt: null,
    lastNotifiedDueAt: null
  });
  showFeedback('Przypomnienie przywrocone.', 'neutral');
}

function snoozeReminder(reminderId, minutes) {
  const nextTime = new Date();
  nextTime.setMinutes(nextTime.getMinutes() + minutes);
  updateReminder(reminderId, {
    dueAt: nextTime.toISOString(),
    lastNotifiedDueAt: null
  });
  showFeedback(`Przypomnienie odlozone o ${minutes} min.`, 'warning');
}

function deleteReminder(reminderId) {
  reminders = reminders.filter((item) => item.id !== reminderId);
  persistReminders();
  renderAll();
  showFeedback('Przypomnienie usuniete.', 'neutral');
}

function deleteVoiceNote(noteId) {
  voiceNotes = voiceNotes.filter((item) => item.id !== noteId);
  persistVoiceNotes();
  renderVoiceNotes();
  showFeedback('Notatka glosowa usunieta.', 'neutral');
}

function clearOldDoneReminders() {
  const originalLength = reminders.length;
  reminders = reminders.filter((item) => item.status !== 'done' || !isOldDoneReminder(item));

  if (reminders.length === originalLength) {
    showFeedback('Nie ma starych wpisow do wyczyszczenia.', 'warning');
    return;
  }

  persistReminders();
  renderAll();
  showFeedback('Usunieto stare zakonczone wpisy.', 'neutral');
}

function updateReminder(reminderId, changes) {
  reminders = reminders.map((item) => {
    if (item.id !== reminderId) {
      return item;
    }

    return { ...item, ...changes };
  });

  persistReminders();
  renderAll();
  checkDueReminders();
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

    const dueTime = new Date(item.dueAt).getTime();
    if (Number.isNaN(dueTime) || dueTime > now) {
      return false;
    }

    if (item.lastNotifiedDueAt === item.dueAt) {
      return false;
    }

    return now - dueTime <= MAX_LATE_NOTIFICATION_MS;
  });

  for (const reminder of dueReminders) {
    markReminderAsNotified(reminder.id, reminder.dueAt);
    showBrowserNotification(reminder).catch(() => {});
    showFeedback(`Teraz: ${reminder.title}.`, 'warning');
  }

  if (dueReminders.length > 0) {
    renderReminderLists();
  }
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
}

async function showBrowserNotification(reminder) {
  if (!('Notification' in window) || Notification.permission !== 'granted') {
    return;
  }

  const options = {
    body: `${reminder.note ? `${reminder.note}. ` : ''}Otworz aplikacje, aby oznaczyc lub odlozyc.`,
    tag: `reminder-${reminder.id}`,
    requireInteraction: true,
    data: {
      reminderId: reminder.id
    }
  };

  const registration = await navigator.serviceWorker.getRegistration();
  if (registration && typeof registration.showNotification === 'function') {
    await registration.showNotification(reminder.title, options);
    return;
  }

  const fallbackNotification = new Notification(reminder.title, options);
  fallbackNotification.addEventListener('click', () => {
    window.focus();
  });
}

function renderNotificationPermissionUI() {
  if (!('Notification' in window)) {
    notificationsPanel.hidden = false;
    notificationsText.textContent = 'Ta przegladarka nie wspiera powiadomien.';
    enableNotificationsButton.hidden = true;
    return;
  }

  notificationsPanel.hidden = false;

  if (Notification.permission === 'granted') {
    notificationsText.textContent = 'Powiadomienia sa wlaczone. Sluza tylko do informacji.';
    enableNotificationsButton.hidden = true;
    return;
  }

  if (Notification.permission === 'denied') {
    notificationsText.textContent = 'Powiadomienia sa zablokowane w przegladarce.';
    enableNotificationsButton.hidden = true;
    return;
  }

  notificationsText.textContent = 'Mozesz wlaczyc powiadomienia, ale glowne akcje wykonuje sie w aplikacji.';
  enableNotificationsButton.hidden = false;
}

function remindAboutNotificationsIfNeeded() {
  if ('Notification' in window && Notification.permission === 'default') {
    renderNotificationPermissionUI();
  }
}

async function requestNotificationPermissionFromUser() {
  if (!('Notification' in window)) {
    showFeedback('Ta przegladarka nie obsluguje powiadomien.', 'warning');
    return;
  }

  try {
    const permission = await Notification.requestPermission();
    renderNotificationPermissionUI();

    if (permission === 'granted') {
      showFeedback('Powiadomienia wlaczone.', 'success');
      checkDueReminders();
      return;
    }

    if (permission === 'denied') {
      showFeedback('Powiadomienia zablokowane.', 'warning');
    }
  } catch {
    showFeedback('Nie udalo sie wlaczyc powiadomien.', 'danger', true);
  }
}

function showFeedback(message, tone = 'neutral', keepVisible = false) {
  feedbackBanner.textContent = message;
  feedbackBanner.className = `feedback-banner ${tone}`;
  feedbackBanner.hidden = false;

  if (feedbackTimeoutId) {
    clearTimeout(feedbackTimeoutId);
  }

  if (keepVisible) {
    return;
  }

  feedbackTimeoutId = window.setTimeout(() => {
    feedbackBanner.hidden = true;
  }, 2400);
}

function applyReminderTone(node, reminder) {
  node.classList.remove('is-overdue', 'is-due-soon', 'is-done');

  if (reminder.status === 'done') {
    node.classList.add('is-done');
    return;
  }

  const diffMinutes = (new Date(reminder.dueAt) - new Date()) / 60000;

  if (diffMinutes < 0) {
    node.classList.add('is-overdue');
    return;
  }

  if (diffMinutes <= 60) {
    node.classList.add('is-due-soon');
  }
}

function formatReminderTime(reminder, isDoneList) {
  if (isDoneList && reminder.completedAt) {
    return `Zrobione: ${formatDateTime(reminder.completedAt)} | Termin: ${formatDateTime(reminder.dueAt)}`;
  }

  const dueDate = new Date(reminder.dueAt);
  const diffMinutes = Math.round((dueDate - new Date()) / 60000);

  if (diffMinutes < 0) {
    return `Po terminie od ${Math.abs(diffMinutes)} min | ${formatDateTime(reminder.dueAt)}`;
  }

  if (diffMinutes <= 60) {
    return `Dzisiaj, za ${diffMinutes} min | ${formatDateTime(reminder.dueAt)}`;
  }

  return formatDateTime(reminder.dueAt);
}

function loadReminders() {
  try {
    const raw = localStorage.getItem(REMINDERS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistReminders() {
  localStorage.setItem(REMINDERS_KEY, JSON.stringify(reminders));
}

function loadVoiceNotes() {
  try {
    const raw = localStorage.getItem(VOICE_NOTES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistVoiceNotes() {
  localStorage.setItem(VOICE_NOTES_KEY, JSON.stringify(voiceNotes));
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

function isOldDoneReminder(reminder) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - DONE_RETENTION_DAYS);
  const completedAt = reminder.completedAt ? new Date(reminder.completedAt) : new Date(reminder.createdAt);
  return completedAt < cutoff;
}

function resetReminderForm() {
  form.reset();
  applyDefaultDateTime();
  titleInput.focus();
}

function applyDefaultDateTime() {
  const next = new Date();
  next.setMinutes(next.getMinutes() + 30);
  dateInput.value = getDateKey(next);
  timeInput.value = `${String(next.getHours()).padStart(2, '0')}:${String(next.getMinutes()).padStart(2, '0')}`;
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

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function createId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }

  return `item-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    return;
  }

  try {
    await navigator.serviceWorker.register('service-worker.js');
  } catch (error) {
    console.warn('Nie udalo sie zarejestrowac service workera.', error);
  }
}
