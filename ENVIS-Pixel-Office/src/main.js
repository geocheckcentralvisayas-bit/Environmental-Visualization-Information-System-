import Phaser from 'phaser';
import employees from '../data/employees.json';
import rooms from '../data/rooms.json';
import bots from '../data/bots.json';
import { OfficeScene } from './OfficeScene.js';
import './style.css';

const roomMap = new Map(rooms.map((room) => [room.id, room]));
const employeeMap = new Map(employees.map((employee) => [employee.id, employee]));
const botMap = new Map(bots.map((bot) => [bot.id, bot]));
const panel = document.querySelector('#info-panel');
const panelContent = document.querySelector('#panel-content');
const botPanel = document.querySelector('#bot-panel');
const botMessages = document.querySelector('#bot-messages');
const botPrompts = document.querySelector('#bot-prompts');
const botInput = document.querySelector('#bot-input');
const sessionClock = document.querySelector('#session-clock');

let activeBot = null;
let sessionEndsAt = 0;
let nightMode = false;

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}


function employeeCard(employee, compact = false) {
  const contact = employee.contact
    ? `<a class="employee-contact" href="mailto:${escapeHtml(employee.contact)}">${escapeHtml(employee.contact)}</a>`
    : '';
  return `
    <article class="employee-card${compact ? ' compact' : ''}">
      <div class="employee-avatar" aria-hidden="true">${escapeHtml(employee.initials)}</div>
      <div class="employee-copy">
        <strong>${escapeHtml(employee.name)}</strong>
        <span class="employee-role">${escapeHtml(employee.role)}</span>
        <span class="employee-position">${escapeHtml(employee.position)}</span>
        <span class="employee-unit">${escapeHtml(employee.unit)}</span>
        ${contact}
        <button class="text-action" type="button" data-employee="${escapeHtml(employee.id)}">View profile</button>
      </div>
    </article>`;
}

function showPanel(title, kicker, content) {
  panelContent.innerHTML = `<div class="panel-kicker">${escapeHtml(kicker)}</div><h2>${escapeHtml(title)}</h2>${content}`;
  panel.classList.remove('is-hidden');
  panel.scrollTop = 0;
  panelContent.querySelectorAll('[data-employee]').forEach((button) => {
    button.addEventListener('click', () => renderEmployee(button.dataset.employee));
  });
  panelContent.querySelectorAll('[data-directory]').forEach((button) => {
    button.addEventListener('click', () => renderDirectory());
  });
}

function renderRoom(roomId) {
  const room = roomMap.get(roomId);
  if (!room) return;

  const roomEmployees = room.employees.map((id) => employeeMap.get(id)).filter(Boolean);
  const peopleMarkup = roomEmployees.length
    ? `<div class="employee-list">${roomEmployees.map((employee) => employeeCard(employee, true)).join('')}</div>`
    : '<p class="empty-state">No individual staff assignment is listed for this shared area.</p>';
  const functionsMarkup = room.functions.map((item) => `<li>${escapeHtml(item)}</li>`).join('');

  showPanel(room.name, 'DENR-EMB REGION VII / DEPARTMENT', `
    <p class="panel-tagline">${escapeHtml(room.tagline)}</p>
    <p class="panel-description">${escapeHtml(room.purpose)}</p>
    <section class="panel-section">
      <h3>ASSIGNED EMB PERSONNEL <span>${roomEmployees.length}</span></h3>
      ${peopleMarkup}
    </section>
    <section class="panel-section">
      <h3>SECTION FUNCTIONS</h3>
      <ul class="function-list">${functionsMarkup}</ul>
    </section>
    <button class="wide-action" type="button" data-directory>View complete personnel directory <span>→</span></button>
  `);
}

function renderEmployee(employeeId) {
  const employee = employeeMap.get(employeeId);
  if (!employee) return;
  const room = roomMap.get(employee.room);
  const authority = employee.authority
    ? `<div class="authority-note"><span>RESPONSIBILITY</span><strong>${escapeHtml(employee.authority)}</strong></div>`
    : '';
  const contact = employee.contact
    ? `<p class="profile-contact">Email: <a href="mailto:${escapeHtml(employee.contact)}">${escapeHtml(employee.contact)}</a></p>`
    : '';

  showPanel('Personnel Profile', 'EMB PERSONNEL PROFILE', `
    <div class="profile-heading">
      <div class="employee-avatar large" aria-hidden="true">${escapeHtml(employee.initials)}</div>
      <div><h2>${escapeHtml(employee.name)}</h2><p>${escapeHtml(employee.role)}</p></div>
    </div>
    <div class="profile-facts">
      <div><span>POSITION</span><strong>${escapeHtml(employee.position)}</strong></div>
      <div><span>OFFICE / UNIT</span><strong>${escapeHtml(employee.unit)}</strong></div>
      <div><span>OFFICE LOCATION</span><strong>${escapeHtml(room?.name || 'Not assigned')}</strong></div>
    </div>
    <p class="panel-description">${escapeHtml(employee.description)}</p>
    ${authority}
    ${contact}
    <button class="wide-action" type="button" data-directory>Back to personnel directory <span>→</span></button>
  `);
}

function renderDirectory() {
  const orderedEmployees = [...employees].sort((a, b) => a.order - b.order);
  const cards = orderedEmployees.map((employee) => employeeCard(employee)).join('');
  showPanel('EMB Region VII Personnel', 'EMPLOYEE DIRECTORY', `
    <p class="panel-tagline">Personnel and assigned responsibilities</p>
    <p class="panel-description">This directory lists the EMB Region VII personnel and roles supplied for this office prototype.</p>
    <div class="directory-count"><strong>${employees.length}</strong><span>PERSONNEL LISTED</span></div>
    <div class="employee-list directory-list">${cards}</div>
  `);
}

function renderLeadership() {
  const platformOwner = employeeMap.get('kent-agbayani');
  const regionalDirector = employeeMap.get('edward-ang');
  showPanel('Office & Platform Leadership', 'LEADERSHIP STRUCTURE', `
    <p class="panel-description">Platform leadership is shown first, followed by the EMB Region VII institutional decision authority.</p>
    <div class="leadership-stack">
      <article class="leader-card platform-leader">
        <span class="leader-label">PLATFORM OWNER / LEAD DEVELOPER</span>
        <div class="leader-name-row"><div class="employee-avatar">${escapeHtml(platformOwner.initials)}</div><div><strong>${escapeHtml(platformOwner.name)}</strong><span>${escapeHtml(platformOwner.role)}</span></div></div>
        <p>Leads ENVIS platform development, GIS implementation, maintenance, and technical administration.</p>
      </article>
      <div class="leadership-connector" aria-hidden="true">↓</div>
      <article class="leader-card director-leader">
        <span class="leader-label">REGIONAL DIRECTOR / FINAL DECISION AUTHORITY</span>
        <div class="leader-name-row"><div class="employee-avatar">${escapeHtml(regionalDirector.initials)}</div><div><strong>${escapeHtml(regionalDirector.name)}</strong><span>${escapeHtml(regionalDirector.position)}</span></div></div>
        <p>Retains final institutional authority for official EMB Region VII decisions, directions, and approvals.</p>
      </article>
    </div>
    <p class="leadership-note">Kent Agbayani administers and maintains the platform. The Regional Director remains the final authority for EMB institutional decisions and approvals.</p>
    <button class="wide-action" type="button" data-directory>View all EMB personnel <span>→</span></button>
  `);
}

function renderHelp() {
  showPanel('How to Use the Office Map', 'QUICK GUIDE', `
    <p class="panel-description">Select a labeled department on the floor map to see its assigned EMB personnel, positions, and section functions.</p>
    <section class="panel-section"><h3>AVAILABLE VIEWS</h3><ul class="function-list">
      <li><strong>Department map:</strong> select any numbered office area to open its details.</li>
      <li><strong>Personnel directory:</strong> review all ten listed EMB employees and their roles.</li>
      <li><strong>Leadership:</strong> view platform ownership and the Regional Director's decision authority.</li>
      <li><strong>Employee profile:</strong> open an individual profile from a room or the directory.</li>
      <li><strong>Bot chat:</strong> click any walking pixel worker to open a scripted bot based on their real role.</li>
      <li><strong>Session clock:</strong> access is limited to MIS and RD for 15 minutes; the timer is shown above.</li>
    </ul></section>
    <p class="small-print">This is an informational office-map prototype. It does not grant system access, approve documents, or connect to EMB databases.</p>
  `);
}

/* ------------------------------------------------------------------ */
/* Scripted bot personas                                               */
/* ------------------------------------------------------------------ */
function appendBotMessage(who, text, color = '#34d399') {
  const row = document.createElement('div');
  row.className = `bot-message ${who === 'them' ? 'them' : 'me'}`;
  row.innerHTML = who === 'them'
    ? `<span class="bot-message-dot" style="background:${escapeHtml(color)}"></span><p>${escapeHtml(text)}</p>`
    : `<p>${escapeHtml(text)}</p>`;
  botMessages.appendChild(row);
  botMessages.scrollTop = botMessages.scrollHeight;
}

function renderBotPrompts(bot) {
  botPrompts.innerHTML = '';
  for (const prompt of bot.prompts ?? []) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'bot-prompt';
    chip.textContent = prompt;
    chip.addEventListener('click', () => sendBotText(prompt));
    botPrompts.appendChild(chip);
  }
}

function botReply(bot, text) {
  const query = text.toLowerCase();
  for (const rule of bot.rules ?? []) {
    if ((rule.match ?? []).some((word) => query.includes(word.toLowerCase()))) return rule.reply;
  }
  return bot.fallback ?? 'I can tell you about my role, my office, and the ENVIS dashboard.';
}

function sendBotText(text) {
  const value = String(text ?? '').trim();
  if (!value || !activeBot) return;
  if (Date.now() > sessionEndsAt && sessionEndsAt > 0) {
    appendBotMessage('them', 'This Pixel Office session has expired. Close the tab and reopen it to continue.', '#fb7185');
    return;
  }
  appendBotMessage('me', value);
  botInput.value = '';
  window.setTimeout(() => {
    appendBotMessage('them', botReply(activeBot, value), activeBot.color);
  }, 260 + Math.random() * 320);
}

function openBot(id) {
  const bot = botMap.get(id);
  const employee = employeeMap.get(id);
  if (!bot || !employee) return;
  activeBot = bot;
  document.querySelector('#bot-name').textContent = bot.name;
  const avatar = document.querySelector('#bot-avatar');
  avatar.textContent = bot.avatar;
  avatar.style.borderColor = bot.color;
  avatar.style.color = bot.color;
  botMessages.innerHTML = '';
  appendBotMessage('them', bot.greeting, bot.color);
  renderBotPrompts(bot);
  botPanel.classList.remove('is-hidden');
  botInput.focus();
}

function renderBotDirectory() {
  if (!botPanel.classList.contains('is-hidden')) {
    botPanel.classList.add('is-hidden');
    return;
  }
  botMessages.innerHTML = '';
  const list = document.createElement('div');
  list.className = 'bot-directory';
  for (const bot of bots) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'bot-directory-item';
    button.innerHTML = `<span style="background:${escapeHtml(bot.color)}">${escapeHtml(bot.avatar)}</span><strong>${escapeHtml(bot.name)}</strong><small>${escapeHtml(bot.short)}</small>`;
    button.addEventListener('click', () => openBot(bot.id));
    list.appendChild(button);
  }
  botMessages.appendChild(list);
  botPrompts.innerHTML = '';
  document.querySelector('#bot-name').textContent = 'Office bots';
  document.querySelector('#bot-avatar').textContent = '◎';
  botPanel.classList.remove('is-hidden');
}

/* ------------------------------------------------------------------ */
/* Timed session + parent bridge                                       */
/* ------------------------------------------------------------------ */
function updateSessionClock() {
  if (!sessionEndsAt) {
    sessionClock.textContent = '--:--';
    return;
  }
  const remaining = sessionEndsAt - Date.now();
  if (remaining <= 0) {
    sessionClock.textContent = '00:00';
    sessionClock.classList.add('expired');
    botInput.disabled = true;
    document.querySelector('.bot-send').disabled = true;
    return;
  }
  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  sessionClock.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  sessionClock.classList.toggle('warning', remaining < 120000);
  if (remaining > 0) {
    botInput.disabled = false;
    document.querySelector('.bot-send').disabled = false;
  }
}
window.setInterval(updateSessionClock, 1000);

window.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;
  if (data.type === 'envis:pixel-session' && Number.isFinite(data.expiresAt)) {
    sessionEndsAt = Number(data.expiresAt);
    updateSessionClock();
  }
  if (data.type === 'envis:pixel-theme') {
    nightMode = Boolean(data.night);
    window.dispatchEvent(new CustomEvent('envis:pixel-night', { detail: nightMode }));
  }
});

function notifyParent(type, detail) {
  if (window.parent === window) return;
  window.parent.postMessage({ type, detail }, window.location.origin);
}

window.addEventListener('envis:room-selected', (event) => {
  renderRoom(event.detail);
  notifyParent('envis:pixel-room', event.detail);
});
window.addEventListener('envis:bot-open', (event) => openBot(event.detail));
document.querySelector('#close-panel').addEventListener('click', () => panel.classList.add('is-hidden'));
document.querySelector('#close-bot').addEventListener('click', () => botPanel.classList.add('is-hidden'));
document.querySelector('#bots-button').addEventListener('click', renderBotDirectory);
document.querySelector('#directory-button').addEventListener('click', renderDirectory);
document.querySelector('#leadership-button').addEventListener('click', renderLeadership);
document.querySelector('#help-button').addEventListener('click', renderHelp);
document.querySelector('#night-button').addEventListener('click', () => {
  nightMode = !nightMode;
  window.dispatchEvent(new CustomEvent('envis:pixel-night', { detail: nightMode }));
});
document.querySelector('#bot-form').addEventListener('submit', (event) => {
  event.preventDefault();
  sendBotText(botInput.value);
});
notifyParent('envis:pixel-ready', { bots: bots.length, rooms: rooms.length });

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game-container',
  backgroundColor: '#d9e7e4',
  pixelArt: true,
  antialias: false,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 1440,
    height: 1080
  },
  scene: [OfficeScene]
});

window.addEventListener('beforeunload', () => game.destroy(true));
