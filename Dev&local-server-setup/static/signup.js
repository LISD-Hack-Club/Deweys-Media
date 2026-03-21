(() => {
  const panels = Array.from(document.querySelectorAll(".step-panel"));
  const dots = Array.from(document.querySelectorAll(".step-dot"));
  const backBtn = document.getElementById("back-btn");
  const nextBtn = document.getElementById("next-btn");
  const finishBtn = document.getElementById("finish-btn");

  const username = document.getElementById("username");
  const password = document.getElementById("password");
  const email = document.getElementById("email");
  const birthday = document.getElementById("birthday");

  const userCheck = document.getElementById("user-check");
  const ageCheck = document.getElementById("age-check");

  const avatar = document.getElementById("avatar");
  const avatarPrev = document.getElementById("avatar-preview-img");

  const revUsername = document.getElementById("rev-username");
  const revEmail = document.getElementById("rev-email");
  const revBirthday = document.getElementById("rev-birthday");
  const revAvatar = document.getElementById("rev-avatar");

  if (!panels.length) return;
  let step = 1;

  function setStep(n){
    step = Math.max(1, Math.min(4, n));
    panels.forEach(p => p.classList.toggle("active", Number(p.dataset.step) === step));
    dots.forEach(d => d.classList.toggle("active", Number(d.dataset.step) === step));

    backBtn.style.display = (step === 1) ? "none" : "inline-flex";
    nextBtn.style.display = (step === 4) ? "none" : "inline-flex";
    finishBtn.style.display = (step === 4) ? "inline-flex" : "none";

    if (step === 4) fillReview();
  }

  function fillReview(){
    revUsername.textContent = username.value || "—";
    revEmail.textContent = email.value || "—";
    revBirthday.textContent = birthday.value || "—";
    revAvatar.textContent = (avatar.files && avatar.files[0]) ? avatar.files[0].name : "No avatar (placeholder)";
  }

  function is13Plus(dateStr){
    if (!dateStr) return false;
    const b = new Date(dateStr + "T00:00:00");
    const now = new Date();
    let age = now.getFullYear() - b.getFullYear();
    const m = now.getMonth() - b.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
    return age >= 13;
  }

  async function checkUsernameAvailability(){
    if (!username.value.trim()){
      userCheck.textContent = "";
      userCheck.className = "hint";
      return false;
    }
    const res = await fetch(`/check_username?u=${encodeURIComponent(username.value.trim())}`);
    const data = await res.json();
    if (data.available){
      userCheck.textContent = "✅ Username available";
      userCheck.className = "hint ok";
      return true;
    } else {
      userCheck.textContent = "❌ Username is taken";
      userCheck.className = "hint bad";
      return false;
    }
  }

  function validateStep2Quick(){
    let ok = true;

    if (!username.value.trim()) ok = false;
    if (!password.value || password.value.length < 6) ok = false;
    if (!email.value || !email.value.includes("@")) ok = false;

    if (!birthday.value){
      ok = false;
      ageCheck.textContent = "❌ Birthday required";
      ageCheck.className = "hint bad";
    } else if (!is13Plus(birthday.value)){
      ok = false;
      ageCheck.textContent = "❌ You must be 13+";
      ageCheck.className = "hint bad";
    } else {
      ageCheck.textContent = "✅ Age OK";
      ageCheck.className = "hint ok";
    }

    return ok;
  }

  backBtn.addEventListener("click", () => setStep(step - 1));

  nextBtn.addEventListener("click", async () => {
    if (step === 1) return setStep(2);

    if (step === 2){
      const localOk = validateStep2Quick();
      if (!localOk){
        alert("Please fill everything correctly (password 6+ and 13+).");
        return;
      }
      const nameOk = await checkUsernameAvailability();
      if (!nameOk){
        alert("That username is taken. Pick another.");
        return;
      }
      return setStep(3);
    }

    if (step === 3) return setStep(4);
  });

  username.addEventListener("blur", () => { checkUsernameAvailability(); });

  birthday.addEventListener("change", () => {
    if (!birthday.value) return;
    if (!is13Plus(birthday.value)){
      ageCheck.textContent = "❌ You must be 13+";
      ageCheck.className = "hint bad";
    } else {
      ageCheck.textContent = "✅ Age OK";
      ageCheck.className = "hint ok";
    }
  });

  avatar.addEventListener("change", () => {
    const f = avatar.files && avatar.files[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    avatarPrev.src = url;
  });

  setStep(1);
})();