const form = document.getElementById('loginForm');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const emailError = document.getElementById('emailError');
const passwordError = document.getElementById('passwordError');
const togglePw = document.getElementById('togglePw');
const submitBtn = document.getElementById('submitBtn');
const btnText = submitBtn.querySelector('.btn-text');
const btnLoader = submitBtn.querySelector('.btn-loader');

togglePw.addEventListener('click', () => {
  const isPassword = passwordInput.type === 'password';
  passwordInput.type = isPassword ? 'text' : 'password';
  togglePw.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
  togglePw.innerHTML = isPassword
    ? `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
        <line x1="1" y1="1" x2="23" y2="23"/>
       </svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
        <circle cx="12" cy="12" r="3"/>
       </svg>`;
});

function validate() {
  let valid = true;

  const emailVal = emailInput.value.trim();
  if (!emailVal) {
    showError(emailInput, emailError, 'Email is required.');
    valid = false;
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) {
    showError(emailInput, emailError, 'Enter a valid email address.');
    valid = false;
  } else {
    clearError(emailInput, emailError);
  }

  const pwVal = passwordInput.value;
  if (!pwVal) {
    showError(passwordInput, passwordError, 'Password is required.');
    valid = false;
  } else if (pwVal.length < 6) {
    showError(passwordInput, passwordError, 'Password must be at least 6 characters.');
    valid = false;
  } else {
    clearError(passwordInput, passwordError);
  }

  return valid;
}

function showError(input, errorEl, msg) {
  input.classList.add('error');
  errorEl.textContent = msg;
}

function clearError(input, errorEl) {
  input.classList.remove('error');
  errorEl.textContent = '';
}

[emailInput, passwordInput].forEach(input => {
  input.addEventListener('input', () => {
    input.classList.remove('error');
    if (input === emailInput) emailError.textContent = '';
    if (input === passwordInput) passwordError.textContent = '';
  });
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!validate()) return;

  submitBtn.disabled = true;
  btnText.hidden = true;
  btnLoader.hidden = false;

  await new Promise(r => setTimeout(r, 1500));

  btnText.hidden = false;
  btnLoader.hidden = true;
  submitBtn.disabled = false;

  alert('Signed in successfully!');
});
