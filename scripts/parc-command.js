/**
 * Combobox de la barre : branche `attachCommandCombobox` du socle.
 * Items / rendu / navigation viennent de `window.__parcCommand` (script inline).
 */
import { attachCommandCombobox } from './command.js';

const api = window.__parcCommand;
const input = document.getElementById('rechercheGlobale');
const list = document.getElementById('resultatsGlobaux');
if (!api || !input || !list) {
  console.warn('parc-command : API ou nœuds absents, combobox non branchée');
} else {
  attachCommandCombobox({
    input,
    list,
    getItems: api.getItems,
    onSelect: api.onSelect,
    renderItem: api.renderItem,
    emptyLabel: null,
    idPrefix: 'resultat',
    clearOnSelect: true,
  });
}
