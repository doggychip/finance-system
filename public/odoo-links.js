// Odoo deep link helper
// Usage: odooLink('journal-items', { account: '303010', company: 'LTECH' })
(function() {
  var ODOO_BASE = 'https://ltech2.odoo.com/odoo/accounting';

  window.odooUrl = function(type, params) {
    params = params || {};
    switch(type) {
      case 'journal-items':
        var url = ODOO_BASE + '/journal-items';
        if (params.account) url += '?search=' + encodeURIComponent(params.account);
        return url;
      case 'chart-of-accounts':
        return ODOO_BASE + '/chart-of-accounts';
      case 'bank-accounts':
        return ODOO_BASE + '/bank-accounts';
      case 'general-ledger':
        return ODOO_BASE + '/reporting/general-ledger';
      case 'trial-balance':
        return ODOO_BASE + '/reporting/trial-balance';
      case 'balance-sheet':
        return ODOO_BASE + '/reporting/balance-sheet';
      case 'profit-loss':
        return ODOO_BASE + '/reporting/profit-and-loss';
      default:
        return ODOO_BASE;
    }
  };

  // Make any element with data-odoo-link clickable
  window.makeOdooLinks = function() {
    document.querySelectorAll('[data-odoo-link]').forEach(function(el) {
      el.style.cursor = 'pointer';
      el.style.textDecoration = 'underline';
      el.style.textDecorationStyle = 'dotted';
      el.addEventListener('click', function() {
        var type = el.getAttribute('data-odoo-link');
        var account = el.getAttribute('data-odoo-account');
        window.open(window.odooUrl(type, { account: account }), '_blank');
      });
    });
  };
})();
