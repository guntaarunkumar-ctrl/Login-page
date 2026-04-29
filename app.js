'use strict';

const form       = document.getElementById('loginForm');
const emailInput = document.getElementById('email');
const pwInput    = document.getElementById('password');
const submitBtn  = document.getElementById('submitBtn');
const spinner    = document.getElementById('spinner');
const btnText    = submitBtn.querySelector('.btn-text');

function showError(inputEl, msgEl, msg) {
  inputEl.classList.add('is-invalid');
  msgEl.textContent = msg;
}

function clearError(inputEl, msgEl) {
  inputEl.classList.remove('is-invalid');
  msgEl.textContent = '';
}

function validateEmail(val) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
}

emailInput.addEventListener('input', () =>
  clearError(emailInput, document.getElementById('emailError'))
);

pwInput.addEventListener('input', () =>
  clearError(pwInput, document.getElementById('passwordError'))
);

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const emailErr = document.getElementById('emailError');
  const pwErr    = document.getElementById('passwordError');
  let valid = true;

  clearError(emailInput, emailErr);
  clearError(pwInput, pwErr);

  if (!emailInput.value.trim()) {
    showError(emailInput, emailErr, 'Email is required.');
    valid = false;
  } else if (!validateEmail(emailInput.value.trim())) {
    showError(emailInput, emailErr, 'Enter a valid email address.');
    valid = false;
  }

  if (!pwInput.value) {
    showError(pwInput, pwErr, 'Password is required.');
    valid = false;
  } else if (pwInput.value.length < 6) {
    showError(pwInput, pwErr, 'Password must be at least 6 characters.');
    valid = false;
  }

  if (!valid) return;

  // Simulate async sign-in
  submitBtn.disabled = true;
  btnText.textContent = 'Signing in…';
  spinner.hidden = false;

  await new Promise(r => setTimeout(r, 1800));

  spinner.hidden = true;
  btnText.textContent = 'Signed in!';
  submitBtn.style.background = 'linear-gradient(135deg, #10b981, #059669)';
  submitBtn.style.boxShadow  = '0 4px 20px rgba(16,185,129,0.45)';
});

function togglePassword() {
  const isText = pwInput.type === 'text';
  pwInput.type = isText ? 'password' : 'text';
  document.getElementById('eyeIcon').innerHTML = isText
    ? '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'
    : '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>';
}
