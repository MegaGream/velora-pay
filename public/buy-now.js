/* Velora Pay — storefront script.
 * Replaces the theme's Add to Cart button with "Buy Now", which asks the app
 * to create a Stripe payment link for the selected variant and redirects to it.
 */
(function () {
  'use strict';

  var current = document.currentScript;
  if (!current || !current.src) return;

  var url = new URL(current.src, window.location.href);
  var shop = url.searchParams.get('shop');
  var appOrigin = url.origin;
  if (!shop) return;

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  function variantIdOf(form) {
    var el = form.querySelector('input[name="id"], select[name="id"]');
    if (!el) return null;
    if (el.tagName === 'SELECT') {
      var opt = el.options[el.selectedIndex];
      return opt ? opt.value : null;
    }
    return el.value;
  }

  function buttonStyle() {
    return [
      'display:block',
      'width:100%',
      'margin-top:10px',
      'padding:14px 18px',
      'border:0',
      'border-radius:4px',
      'background:#111111',
      'color:#ffffff',
      'font-weight:600',
      'font-size:15px',
      'letter-spacing:.02em',
      'cursor:pointer',
    ].join(';');
  }

  function init() {
    // Product pages only: the theme's add-to-cart form.
    var form = document.querySelector('form[action*="/cart/add"]');
    if (!form) return;

    var submit = form.querySelector('[type="submit"]');
    if (!submit || submit.dataset.veloraBound) return;

    var buy = document.createElement('button');
    buy.type = 'button';
    buy.className = 'velora-buy-now';
    buy.textContent = 'Buy Now';
    buy.setAttribute('style', buttonStyle());

    submit.style.display = 'none';
    submit.dataset.veloraBound = '1';
    form.appendChild(buy);

    buy.addEventListener('click', function (event) {
      event.preventDefault();

      var variantId = variantIdOf(form);
      if (!variantId) {
        window.alert('Please select a product variant first.');
        return;
      }

      var qtyInput = form.querySelector('input[name="quantity"]');
      var quantity = qtyInput ? parseInt(qtyInput.value, 10) || 1 : 1;

      buy.disabled = true;
      buy.textContent = 'Redirecting…';

      fetch(appOrigin + '/api/create-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shop: shop, variantId: variantId, quantity: quantity }),
      })
        .then(function (response) {
          return response.json().then(function (body) {
            return { ok: response.ok, body: body };
          });
        })
        .then(function (result) {
          if (result.ok && result.body && result.body.url) {
            window.location.href = result.body.url;
            return;
          }
          window.alert(
            (result.body && result.body.error) || 'Payment could not be created.'
          );
          buy.disabled = false;
          buy.textContent = 'Buy Now';
        })
        .catch(function () {
          window.alert('Network error. Please try again.');
          buy.disabled = false;
          buy.textContent = 'Buy Now';
        });
    });
  }

  // Some themes boot late; retry a few times.
  ready(function () {
    init();
    var attempts = 0;
    var timer = setInterval(function () {
      attempts += 1;
      if (document.querySelector('.velora-buy-now') || attempts > 10) {
        clearInterval(timer);
        return;
      }
      init();
    }, 500);
  });
})();
