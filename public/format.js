// Shared formatting utilities for the Finance Dashboard
// Usage: include <script src="/format.js"></script> before page scripts

(function() {
  // Format currency with accounting parentheses for negatives
  // formatCurrency(1234567)     → "$1,234,567"
  // formatCurrency(-1234567)    → "($1,234,567)"
  // formatCurrency(0)           → "-"
  // formatCurrency(1234567, {short: true}) → "$1.2M"
  window.formatCurrency = function(n, opts) {
    opts = opts || {};
    if (n == null || isNaN(n)) return opts.placeholder || '--';
    if (Math.abs(n) < 0.5) return '-';

    if (opts.short) {
      var abs = Math.abs(n);
      var str;
      if (abs >= 1e6) str = '$' + (abs / 1e6).toFixed(1) + 'M';
      else if (abs >= 1e3) str = '$' + (abs / 1e3).toFixed(0) + 'K';
      else str = '$' + Math.round(abs);
      return n < 0 ? '-' + str : str;
    }

    var s = Math.abs(Math.round(n)).toLocaleString('en-US');
    if (opts.dollar) s = '$' + s;
    return n < 0 ? '(' + s + ')' : s;
  };

  // Format percentage
  window.formatPct = function(n) {
    if (n == null || isNaN(n) || !isFinite(n)) return '';
    return (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
  };

  // CSS class for value display
  window.valClass = function(n) {
    if (Math.abs(n) < 0.5) return 'zero';
    return n < 0 ? 'negative' : 'positive';
  };
})();
