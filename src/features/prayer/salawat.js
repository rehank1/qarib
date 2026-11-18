// A gentle reminder each time the app is opened: send salawat on the Prophet ﷺ.
// Native <dialog>: focus is kept inside, Escape closes it, and screen readers announce it. Can be turned off in Settings.
import { h } from '../../core/dom.js';

export function showSalawat(ctx) {
  if (ctx.state.settings.salawat === false || document.getElementById('salawat')) return;
  const close = () => { dlg.close(); dlg.remove(); };
  const done = h('button', { class: 'btn primary block', type: 'button', onclick: close }, 'Ṣallallāhu ʿalayhi wa sallam');
  const dlg = h('dialog', { id: 'salawat', class: 'salawat', 'aria-labelledby': 'salawat-h', 'aria-describedby': 'salawat-t' },
    h('p', { class: 'salawat-eyebrow', id: 'salawat-h', text: 'Send salawat on the Prophet ﷺ' }),
    h('p', { class: 'salawat-ar', lang: 'ar', dir: 'rtl', text: 'اللَّهُمَّ صَلِّ عَلَى مُحَمَّدٍ وَعَلَى آلِ مُحَمَّدٍ' }),
    h('p', { class: 'salawat-tr', text: 'Allāhumma ṣalli ʿalā Muḥammadin wa ʿalā āli Muḥammad' }),
    h('p', { class: 'muted small', id: 'salawat-t', text: 'O Allah, send blessings upon Muhammad and upon the family of Muhammad.' }),
    done,
  );
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); }); // Escape / Android back button
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); }); // tap outside
  document.body.append(dlg);
  dlg.showModal();
  done.focus();
}
