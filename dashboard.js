'use strict';

const auth = firebase.auth();

auth.onAuthStateChanged(user => {
  if (!user) {
    window.location.href = 'index.html';
    return;
  }

  const name  = user.displayName || user.email.split('@')[0];
  const email = user.email || '';

  document.getElementById('welcomeName').textContent  = 'Welcome, ' + name + '!';
  document.getElementById('welcomeEmail').textContent = email;

  // Avatar: photo from provider or initials
  const avatarEl = document.getElementById('avatar');
  if (user.photoURL) {
    const img = document.createElement('img');
    img.src = user.photoURL;
    img.alt = name;
    avatarEl.appendChild(img);
  } else {
    avatarEl.textContent = name.charAt(0).toUpperCase();
  }

  // Last login time
  const lastLogin = user.metadata.lastSignInTime;
  if (lastLogin) {
    document.getElementById('lastLogin').textContent =
      new Date(lastLogin).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  document.getElementById('dashWrapper').hidden = false;
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await auth.signOut();
  window.location.href = 'index.html';
});
