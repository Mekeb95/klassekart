'use strict';

import { RULE_SYMBOL } from './constants.js';
import { state } from './state.js';
import { brokenSeatRules } from './randomize.js';
import { brokenGroupRules } from './groups.js';

// The rule list in the left sidebar. Its own module because both tools need to
// refresh it — render.js after desk changes, groups-view.js after group changes
// — and neither of those may import the other.
//
// Rules are sensitive: the teacher's screen is often on the projector. Names in
// a rule are therefore only ever shown here, inside the collapsed «Regler»
// panel, never in the chart or the group cards.

const $ = id => document.getElementById(id);

/** Rules the arrangement on screen breaks right now, for whichever tab is showing. */
function currentlyBroken() {
  if (state.mode === 'groups') {
    const res = state.groups.result;
    if (!state.useRulesGroups || !res) return new Set();
    return new Set(brokenGroupRules(res.groups.map(g => g.members.map(m => m.name)), state.rules));
  }
  return new Set(state.useRulesSeating ? brokenSeatRules(state.desks, state.rules) : []);
}

export function renderRuleList() {
  const groups = state.mode === 'groups';
  const active = groups ? state.useRulesGroups : state.useRulesSeating;
  const known  = new Set(state.students);
  const broken = currentlyBroken();

  const ul = $('rule-list');
  ul.textContent = '';
  ul.classList.toggle('rules-off', !active);

  const nameSpan = name => {
    const span = document.createElement('span');
    span.textContent = name;
    if (!known.has(name)) {
      span.className = 'rule-unknown';
      span.title     = 'Står ikke i elevlisten';
    }
    return span;
  };

  state.rules.forEach((rule, i) => {
    const li   = document.createElement('li');
    const text = document.createElement('span');
    text.className = 'rule-text';
    text.title = `${rule.a} og ${rule.b} skal ${rule.type === 'together' ? '' : 'ikke '}være sammen`;
    if (broken.has(rule)) {
      li.className = 'rule-broken';
      text.title  += ' — brytes nå';
    }

    const sym = document.createElement('span');
    sym.className   = 'rule-sym';
    sym.textContent = RULE_SYMBOL[rule.type];
    text.append(nameSpan(rule.a), sym, nameSpan(rule.b));

    const btn = document.createElement('button');
    btn.textContent    = '×';
    btn.className      = 'rule-remove';
    btn.title          = 'Fjern regel';
    btn.dataset.action = 'remove-rule';
    btn.dataset.index  = i;

    li.append(text, btn);
    ul.appendChild(li);
  });

  // Count and alert live in the summary but are hidden by CSS while the panel
  // is closed, so a closed panel reveals nothing about the rules.
  $('rule-count').textContent = state.rules.length ? `(${state.rules.length})` : '';
  $('rule-alert').hidden = broken.size === 0;
  $('rule-alert').title  = broken.size === 1 ? '1 regel brytes' : `${broken.size} regler brytes`;

  $('rule-hint').textContent = groups
    ? '🚫 ulike grupper · 🤝 samme gruppe'
    : '🚫 ikke nabo · 🤝 nabo, også på skrå';
  $('rule-options').hidden         = state.rules.length === 0;
  $('use-rules').checked           = active;
  $('use-rules-label').textContent = groups ? 'Bruk reglene når gruppene trekkes' : 'Bruk reglene ved randomisering';
}
