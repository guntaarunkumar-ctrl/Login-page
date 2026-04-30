'use strict';

const auth          = firebase.auth();
const googleProvider = new firebase.auth.GoogleAuthProvider();
const githubProvider = new firebase.auth.GithubAuthProvider();

const form         = document.getElementById('loginForm');
const emailInput   = document.getElementById('email');
const pwInput      = document.getElementById('password');
const nameInput    = document.getElementById('name');
const submitBtn    = document.getElementById('submitBtn');
const spinner      = document.getElementById('spinner');
const btnText      = submitBtn.querySelector('.btn-text');
const alertBox     = document.getElementById('alertBox');
const nameField    = document.getElementById('nameField');
const rememberRow  = document.getElementById('rememberRow');
const forgotLink   = document.getElementById('forgotLink');
const toggleMode   = document.getElementById('toggleMode');
const formTitle    = document.getElementById('formTitle');
const formSubtitle = document.getElementById('formSubtitle');
const togglePrompt = document.getElementById('togglePromptText');

let isRegisterMode = false;

// Redirect if already signed in
auth.onAuthStateChanged(user => {
  if (user) window.location.href = 'project.html';
});

// ── Helpers ──────────────────────────────────────────────

function showAlert(msg, type = 'error') {
  alertBox.textContent = msg;
  alertBox.className = 'alert alert-' + type;
  alertBox.hidden = false;
}

function clearAlert() { alertBox.hidden = true; }

function showFieldError(inputEl, msgEl, msg) {
  inputEl.classList.add('is-invalid');
  document.getElementById(msgEl).textContent = msg;
}

function clearFieldError(inputEl, msgEl) {
  inputEl.classList.remove('is-invalid');
  document.getElementById(msgEl).textContent = '';
}

function setLoading(loading) {
  submitBtn.disabled = loading;
  spinner.hidden = !loading;
  btnText.textContent = loading ? (isRegisterMode ? 'Creating account…' : 'Signing in…') : (isRegisterMode ? 'Create account' : 'Sign in');
}

function firebaseError(code) {
  const map = {
    'auth/user-not-found':       'No account found with this email.',
    'auth/wrong-password':       'Incorrect password. Try again.',
    'auth/invalid-email':        'Enter a valid email address.',
    'auth/email-already-in-use': 'An account with this email already exists.',
    'auth/weak-password':        'Password must be at least 6 characters.',
    'auth/too-many-requests':    'Too many attempts. Please wait a moment.',
    'auth/popup-closed-by-user': 'Sign-in popup was closed.',
    'auth/network-request-failed': 'Network error. Check your connection.',
    'auth/invalid-credential':   'Invalid email or password.',
  };
  return map[code] || 'Something went wrong. Please try again.';
}

// ── Toggle login / register ───────────────────────────────

toggleMode.addEventListener('click', (e) => {
  e.preventDefault();
  clearAlert();
  isRegisterMode = !isRegisterMode;

  if (isRegisterMode) {
    formTitle.textContent    = 'Create account';
    formSubtitle.textContent = 'Sign up to get started for free';
    btnText.textContent      = 'Create account';
    nameField.hidden         = false;
    rememberRow.hidden       = true;
    forgotLink.hidden        = true;
    togglePrompt.textContent = 'Already have an account?';
    toggleMode.textContent   = 'Sign in';
  } else {
    formTitle.textContent    = 'Welcome back';
    formSubtitle.textContent = 'Sign in to your account to continue';
    btnText.textContent      = 'Sign in';
    nameField.hidden         = true;
    rememberRow.hidden       = false;
    forgotLink.hidden        = false;
    togglePrompt.textContent = "Don't have an account?";
    toggleMode.textContent   = 'Create one free';
  }
});

// ── Forgot password ───────────────────────────────────────

forgotLink.addEventListener('click', async (e) => {
  e.preventDefault();
  const email = emailInput.value.trim();
  if (!email) {
    showAlert('Enter your email above, then tap "Forgot password?".');
    return;
  }
  try {
    await auth.sendPasswordResetEmail(email);
    showAlert('Password reset email sent! Check your inbox.', 'success');
  } catch (err) {
    showAlert(firebaseError(err.code));
  }
});

// ── Clear errors on input ─────────────────────────────────

emailInput.addEventListener('input', () => { clearFieldError(emailInput, 'emailError'); clearAlert(); });
pwInput.addEventListener('input',    () => { clearFieldError(pwInput, 'passwordError'); clearAlert(); });
nameInput.addEventListener('input',  () => { clearFieldError(nameInput, 'nameError'); clearAlert(); });

// ── Form submit ───────────────────────────────────────────

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearAlert();

  let valid = true;
  const email = emailInput.value.trim();
  const pw    = pwInput.value;
  const name  = nameInput.value.trim();

  clearFieldError(emailInput, 'emailError');
  clearFieldError(pwInput, 'passwordError');
  clearFieldError(nameInput, 'nameError');

  if (isRegisterMode && !name) {
    showFieldError(nameInput, 'nameError', 'Name is required.');
    valid = false;
  }
  if (!email) {
    showFieldError(emailInput, 'emailError', 'Email is required.');
    valid = false;
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showFieldError(emailInput, 'emailError', 'Enter a valid email address.');
    valid = false;
  }
  if (!pw) {
    showFieldError(pwInput, 'passwordError', 'Password is required.');
    valid = false;
  } else if (pw.length < 6) {
    showFieldError(pwInput, 'passwordError', 'Password must be at least 6 characters.');
    valid = false;
  }
  if (!valid) return;

  setLoading(true);
  try {
    if (isRegisterMode) {
      const cred = await auth.createUserWithEmailAndPassword(email, pw);
      await cred.user.updateProfile({ displayName: name });
    } else {
      const persistence = document.getElementById('remember').checked
        ? firebase.auth.Auth.Persistence.LOCAL
        : firebase.auth.Auth.Persistence.SESSION;
      await auth.setPersistence(persistence);
      await auth.signInWithEmailAndPassword(email, pw);
    }
    // onAuthStateChanged will redirect to dashboard
  } catch (err) {
    showAlert(firebaseError(err.code));
    setLoading(false);
  }
});

// ── Social sign-in ────────────────────────────────────────

async function socialSignIn(provider) {
  clearAlert();
  try {
    await auth.signInWithPopup(provider);
    // onAuthStateChanged handles redirect
  } catch (err) {
    if (err.code !== 'auth/popup-closed-by-user') {
      showAlert(firebaseError(err.code));
    }
  }
}

document.getElementById('googleBtn').addEventListener('click', () => socialSignIn(googleProvider));
document.getElementById('githubBtn').addEventListener('click', () => socialSignIn(githubProvider));

// ── Password toggle ───────────────────────────────────────

function togglePassword() {
  const isText = pwInput.type === 'text';
  pwInput.type = isText ? 'password' : 'text';
  document.getElementById('eyeIcon').innerHTML = isText
    ? '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'
    : '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>';
}
