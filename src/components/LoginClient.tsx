"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import s from "./login.module.css";

/** EN / AR copy — mirrors the approved static design. */
const T = {
  en: {
    langBtn: "عربي",
    eyebrow: "MagicTech Workspace",
    h1: "<em>Quotation</em> Designer,<br>Material Pricing<br>&amp; Lead Management",
    sub: "Design quotations, price materials and manage your leads — from the first RFQ to the delivered job, in one connected workspace.",
    f1: "RFQ → Quotation in minutes",
    f2: "Live material pricing & margins",
    f3: "Lead & pipeline management",
    f4: "Role-based & fully audited",
    s1: "Quotes issued",
    s2: "Active RFQs",
    s3: "Projects live",
    chip: "Sign in",
    welcome: "Welcome back",
    sub2: "Enter your credentials to continue.",
    userL: "Username",
    userP: "your.username",
    passL: "Password",
    rem: "Remember me",
    forgot: "Forgot password?",
    forgotNote:
      "Passwords are managed by your administrator — ask them to reset yours.",
    signin: "Sign in",
    foot: "Protected workspace · role-based & audited.",
    t1: "Encrypted",
    t2: "Role-based",
    t3: "Audited",
  },
  ar: {
    langBtn: "EN",
    eyebrow: "مساحة عمل سحر التقنية",
    h1: "مصمّم <em>عروض الأسعار</em>،<br>تسعير المواد<br>وإدارة العملاء المحتملين",
    sub: "صمّم عروض الأسعار، سعّر المواد وتابع عملاءك المحتملين — من أول طلب عرض سعر حتى تسليم المشروع، في مساحة عمل واحدة متّصلة.",
    f1: "من الطلب إلى عرض السعر في دقائق",
    f2: "تسعير مباشر للمواد والهوامش",
    f3: "إدارة العملاء المحتملين والمبيعات",
    f4: "صلاحيات مدارة وتدقيق كامل",
    s1: "عرض سعر صادر",
    s2: "طلبات نشطة",
    s3: "مشروعًا قائمًا",
    chip: "تسجيل الدخول",
    welcome: "أهلاً بعودتك",
    sub2: "أدخل بياناتك للمتابعة.",
    userL: "اسم المستخدم",
    userP: "اسم.المستخدم",
    passL: "كلمة المرور",
    rem: "تذكرني",
    forgot: "نسيت كلمة المرور؟",
    forgotNote: "كلمات المرور يديرها المشرف — اطلب منه إعادة تعيين كلمتك.",
    signin: "تسجيل الدخول",
    foot: "مساحة عمل محمية · صلاحيات مدارة وتدقيق كامل.",
    t1: "مشفّرة",
    t2: "صلاحيات",
    t3: "مدقّقة",
  },
} as const;

type Lang = keyof typeof T;

export default function LoginClient({ className = "" }: { className?: string }) {
  const router = useRouter();
  const [lang, setLang] = useState<Lang>("en");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const t = T[lang];
  const dir = lang === "ar" ? "rtl" : "ltr";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Login failed");

      // A must-change account goes straight to the change-password screen
      // (middleware would bounce it there anyway; this just skips the hop).
      if (data.user?.must_change_password) {
        router.push("/change-password");
        router.refresh();
        return;
      }
      // Otherwise honour a same-origin `?next=`, never an absolute URL.
      const nextParam = new URLSearchParams(window.location.search).get("next");
      const dest =
        nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//")
          ? nextParam
          : "/";
      router.push(dest);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  }

  return (
    <div className={`${s.root} ${className}`} data-lang={lang} dir={dir} lang={lang}>
      {/* ══ brand side ══ */}
      <aside className={s.brand}>
        <div className={s.brandTop}>
          <svg className={s.logo} viewBox="0 0 1632 402" role="img" aria-label="MagicTech">
            <g transform="translate(0,402) scale(0.1,-0.1)">
              <path
                fill="currentColor"
                d="M15969 3266 c-91 -32 -147 -91 -175 -182 -77 -258 253 -455 444 -264 116 116 103 311 -28 406 -71 52 -165 67 -241 40z m145 -57 c76 -21 146 -119 146 -205 0 -87 -88 -183 -180 -199 -118 -20 -235 82 -234 205 0 143 128 238 268 199z M15980 3005 c0 -96 3 -115 15 -115 11 0 15 12 15 50 0 43 3 50 19 50 28 0 49 -25 57 -65 4 -26 11 -35 25 -35 21 0 19 29 -6 82 -11 23 -11 29 1 39 20 16 17 73 -4 92 -12 11 -36 17 -70 17 l-52 0 0 -115z m104 62 c9 -15 7 -22 -13 -38 -40 -33 -61 -25 -61 22 0 39 1 40 31 37 18 -2 37 -11 43 -21z M6889 2633 l-66 -208 255 -3 c140 -1 256 -1 258 1 2 2 65 194 128 395 l7 22 -258 0 -259 0 -65 -207z M14495 1897 c-164 -518 -322 -1015 -351 -1104 l-52 -163 257 0 257 0 128 403 c137 426 178 530 252 633 162 228 471 279 515 85 12 -54 0 -100 -166 -620 -85 -268 -155 -490 -155 -494 0 -4 115 -7 255 -7 l254 0 90 278 c210 650 252 786 267 874 47 269 -59 430 -306 469 -188 29 -419 -42 -609 -186 -40 -31 -75 -54 -78 -52 -2 3 52 180 120 393 69 214 128 399 132 412 l6 22 -258 0 -258 0 -300 -943z M661 2688 c-116 -358 -651 -2040 -651 -2048 0 -6 90 -10 258 -10 l259 0 243 766 c181 568 246 760 252 742 3 -12 37 -265 74 -560 l68 -538 151 0 152 0 422 556 c233 305 425 554 427 551 2 -2 -104 -342 -236 -756 -132 -415 -240 -755 -240 -757 0 -3 118 -3 261 -2 l261 3 314 980 c173 539 325 1015 338 1058 l24 77 -351 0 -352 -1 -420 -554 c-231 -305 -422 -554 -425 -555 -3 0 -35 250 -70 555 l-65 555 -337 0 -336 0 -21 -62z M3695 2254 c-149 -12 -264 -27 -386 -50 l-136 -26 -57 -181 c-32 -99 -61 -187 -64 -195 -4 -11 0 -14 14 -9 10 4 71 24 134 46 219 75 507 98 652 52 112 -36 153 -108 117 -208 l-10 -30 -257 -6 c-350 -7 -482 -32 -672 -125 -394 -193 -494 -727 -165 -883 233 -111 572 -34 798 179 20 20 37 34 37 31 0 -3 -13 -48 -30 -99 -16 -52 -30 -101 -30 -107 0 -10 57 -13 254 -13 l254 0 11 33 c5 17 69 216 141 440 163 511 177 557 191 662 33 254 -86 410 -355 466 -90 19 -334 31 -441 23z m145 -969 c-51 -149 -144 -260 -267 -318 -90 -42 -234 -47 -294 -9 -135 83 -66 292 115 351 85 28 89 28 288 30 l177 1 -19 -55z M8205 2250 c-564 -61 -1002 -478 -1075 -1020 -61 -452 284 -700 880 -630 93 10 325 62 338 74 7 7 132 409 128 413 -2 2 -40 -15 -84 -37 -231 -116 -520 -121 -635 -12 -72 68 -94 185 -62 328 95 433 536 649 904 443 31 -17 64 -38 74 -47 9 -8 19 -13 21 -11 6 6 129 392 130 408 4 53 -407 114 -619 91z M11898 2249 c-513 -63 -936 -458 -1023 -953 -63 -361 89 -604 425 -681 225 -52 649 -16 930 78 l95 32 62 194 c34 107 61 196 59 198 -2 2 -29 -9 -62 -23 -403 -179 -812 -215 -942 -81 -52 54 -74 145 -56 236 l7 31 593 0 593 0 30 93 c42 132 49 162 61 260 52 422 -270 678 -772 616z m162 -356 c80 -32 116 -103 108 -207 -3 -35 -9 -69 -12 -75 -8 -13 -646 -16 -646 -3 0 22 69 121 119 171 120 120 300 168 431 114z M13790 2249 c-519 -51 -960 -446 -1056 -947 -68 -357 71 -593 403 -684 68 -19 105 -22 283 -22 213 0 299 11 465 62 l60 18 63 203 c35 111 62 204 60 207 -3 2 -29 -9 -59 -25 -214 -116 -507 -136 -635 -43 -68 50 -99 121 -98 227 2 395 369 711 736 634 54 -11 188 -71 245 -109 l31 -21 60 188 c33 103 63 198 67 210 8 27 -3 32 -140 68 -155 41 -305 52 -485 34z M5310 2229 c-349 -91 -675 -462 -767 -873 -25 -112 -23 -304 4 -391 69 -220 235 -334 489 -335 160 0 303 56 457 180 l85 68 -28 -84 c-97 -287 -250 -415 -525 -444 -173 -18 -344 17 -489 101 -38 22 -73 36 -77 32 -4 -5 -34 -92 -67 -196 -69 -216 -76 -192 68 -230 294 -79 645 -71 925 19 313 102 535 327 669 679 23 62 447 1385 462 1443 l6 22 -258 -2 -258 -3 -34 -108 -33 -108 -38 58 c-61 95 -138 150 -246 179 -75 21 -255 17 -345 -7z m397 -381 c194 -128 40 -649 -234 -796 -184 -98 -368 -47 -404 112 -43 195 98 523 278 647 110 76 276 93 360 37z M6755 2208 c-3 -7 -113 -353 -245 -768 -132 -415 -245 -767 -250 -782 l-9 -28 257 0 257 0 248 775 c137 427 251 784 254 795 5 20 -1 20 -251 20 -196 0 -258 -3 -261 -12z"
              />
              <path
                fill="#ED1C24"
                d="M800 3960 l0 -60 55 0 55 0 0 60 0 60 -55 0 -55 0 0 -60z M950 3960 l0 -60 55 0 55 0 0 60 0 60 -55 0 -55 0 0 -60z M2480 3960 l0 -60 55 0 55 0 0 60 0 60 -55 0 -55 0 0 -60z M2870 3960 l0 -60 55 0 55 0 0 60 0 60 -55 0 -55 0 0 -60z M3030 3960 l0 -60 55 0 55 0 0 60 0 60 -55 0 -55 0 0 -60z M3400 3960 l0 -60 55 0 55 0 0 60 0 60 -55 0 -55 0 0 -60z M3560 3960 l0 -60 50 0 50 0 0 60 0 60 -50 0 -50 0 0 -60z M3860 3740 l0 -280 -101 0 c-154 0 -169 17 -169 185 l0 105 -55 0 -55 0 0 -123 c0 -172 4 -167 -161 -167 -71 0 -129 1 -129 3 0 1 9 20 20 42 49 97 8 227 -89 277 -201 105 -425 -83 -327 -275 l23 -47 -79 0 c-130 0 -148 22 -148 185 l0 105 -55 0 -55 0 0 -128 c0 -166 4 -162 -149 -162 -111 0 -113 0 -142 29 -29 29 -29 31 -29 145 l0 116 -54 0 -54 0 -4 -128 c-2 -91 -7 -134 -17 -145 -12 -15 -56 -17 -442 -17 l-428 0 -15 22 c-13 18 -16 53 -16 170 l0 148 -110 0 c-138 0 -202 -13 -245 -51 -99 -88 -81 -279 32 -335 62 -31 160 -27 207 10 40 30 40 30 66 -15 27 -47 51 -49 514 -49 417 0 439 1 476 20 21 11 43 28 49 37 9 17 11 16 26 -5 31 -43 66 -52 195 -52 128 0 170 10 204 48 l19 22 38 -35 39 -35 410 0 c441 0 458 2 495 51 l18 24 37 -37 38 -38 166 0 166 0 0 330 0 330 -55 0 -55 0 0 -280z m-782 -53 c29 -27 46 -86 38 -131 -24 -129 -193 -140 -226 -16 -35 129 96 232 188 147z m-2059 -66 c-4 -88 -20 -115 -73 -130 -108 -28 -173 94 -92 175 32 32 38 34 101 34 l67 0 -3 -79z M4070 3690 l0 -330 55 0 55 0 0 330 0 330 -55 0 -55 0 0 -330z M6189 3797 c-88 -33 -149 -94 -164 -164 l-7 -33 54 0 c49 0 54 2 66 30 32 71 160 106 234 63 57 -33 78 -76 78 -159 l0 -74 -755 0 c-742 0 -755 0 -775 20 -18 18 -20 33 -20 145 l0 125 -54 0 -55 0 -3 -240 c-3 -233 -4 -240 -25 -262 -20 -20 -27 -21 -63 -11 l-40 10 0 -47 c0 -55 7 -60 78 -60 102 0 149 55 159 184 l6 75 25 -19 c24 -19 45 -20 823 -20 l799 0 6 27 c6 22 9 24 18 11 22 -30 56 -38 164 -38 92 0 113 3 133 19 22 18 23 18 58 -2 48 -29 154 -29 202 0 35 20 36 20 58 2 20 -16 42 -19 157 -19 l134 0 0 195 0 195 -55 0 -55 0 0 -145 0 -145 -74 0 c-101 0 -106 7 -106 157 l0 113 -55 0 -55 0 0 -117 c0 -65 -4 -123 -8 -130 -12 -19 -64 -35 -92 -28 -54 14 -60 29 -60 152 l0 113 -55 0 -55 0 0 -113 c0 -143 -3 -147 -116 -147 -107 0 -119 9 -128 96 -12 114 -51 176 -140 221 -62 32 -179 41 -237 20z M9233 3365 l-91 -275 419 0 c230 0 419 -3 419 -8 0 -4 -182 -554 -405 -1222 -223 -668 -405 -1218 -405 -1222 0 -5 123 -8 274 -8 l274 0 12 33 c82 228 950 2848 950 2869 0 40 -24 82 -55 96 -19 9 -190 12 -663 12 l-637 0 -92 -275z M1980 3215 l0 -55 55 0 55 0 0 55 0 55 -55 0 -55 0 0 -55z M2130 3215 l0 -55 55 0 55 0 0 55 0 55 -55 0 -55 0 0 -55z M10789 3084 c-28 -8 -63 -30 -87 -55 -41 -40 -44 -49 -513 -1462 -260 -782 -482 -1455 -495 -1494 l-22 -73 277 0 277 0 423 1275 422 1275 422 0 423 0 83 258 c46 141 86 265 88 275 7 24 -1220 25 -1298 1z"
              />
            </g>
          </svg>
          <button
            className={s.langBtn}
            type="button"
            onClick={() => setLang((l) => (l === "en" ? "ar" : "en"))}
          >
            {t.langBtn}
          </button>
        </div>

        <div className={s.brandMain}>
          <span className={s.eyebrow}>{t.eyebrow}</span>
          <h1
            className={`${s.h1} ${s.disp}`}
            dangerouslySetInnerHTML={{ __html: t.h1 }}
          />
          <p className={s.sub}>{t.sub}</p>

          <div className={s.features}>
            <div className={s.feature}>
              <svg viewBox="0 0 24 24">
                <path d="M13 3H6v18h12V8z" />
                <path d="M13 3v5h5" />
                <path d="M9 13h6M9 17h6" />
              </svg>
              <span>{t.f1}</span>
            </div>
            <div className={s.feature}>
              <svg viewBox="0 0 24 24">
                <path d="M3 17l6-6 4 4 8-8" />
                <path d="M15 7h6v6" />
              </svg>
              <span>{t.f2}</span>
            </div>
            <div className={s.feature}>
              <svg viewBox="0 0 24 24">
                <path d="M9 6h11M9 12h11M9 18h11" />
                <path d="M4 6h.01M4 12h.01M4 18h.01" />
              </svg>
              <span>{t.f3}</span>
            </div>
            <div className={s.feature}>
              <svg viewBox="0 0 24 24">
                <path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z" />
                <path d="M9 12l2 2 4-4" />
              </svg>
              <span>{t.f4}</span>
            </div>
          </div>

          <div className={s.stats}>
            <div className={s.stat}>
              <b>1.2k+</b>
              <span>{t.s1}</span>
            </div>
            <div className={s.stat}>
              <b>32</b>
              <span>{t.s2}</span>
            </div>
            <div className={s.stat}>
              <b>24</b>
              <span>{t.s3}</span>
            </div>
          </div>
        </div>
      </aside>

      {/* ghost 7T mark sliding under the cut */}
      <svg className={s.ghost} viewBox="0 0 299 366" aria-hidden="true">
        <g transform="translate(0,366) scale(0.1,-0.1)">
          <path d="M113 3365 l-91 -275 419 0 c230 0 419 -3 419 -8 0 -4 -182 -554 -405 -1222 -223 -668 -405 -1218 -405 -1222 0 -5 123 -8 274 -8 l274 0 12 33 c82 228 950 2848 950 2869 0 40 -24 82 -55 96 -19 9 -190 12 -663 12 l-637 0 -92 -275z M1669 3084 c-28 -8 -63 -30 -87 -55 -41 -40 -44 -49 -513 -1462 -260 -782 -482 -1455 -495 -1494 l-22 -73 277 0 277 0 423 1275 422 1275 422 0 423 0 83 258 c46 141 86 265 88 275 7 24 -1220 25 -1298 1z" />
        </g>
      </svg>

      {/* ══ auth side — cut at the wordmark's 12° ══ */}
      <div className={s.authEdge} aria-hidden="true" />
      <main className={s.auth}>
        <form className={s.card} onSubmit={onSubmit} noValidate>
          <svg className={s.crest} viewBox="0 0 299 366" aria-hidden="true">
            <g transform="translate(0,366) scale(0.1,-0.1)">
              <path d="M113 3365 l-91 -275 419 0 c230 0 419 -3 419 -8 0 -4 -182 -554 -405 -1222 -223 -668 -405 -1218 -405 -1222 0 -5 123 -8 274 -8 l274 0 12 33 c82 228 950 2848 950 2869 0 40 -24 82 -55 96 -19 9 -190 12 -663 12 l-637 0 -92 -275z M1669 3084 c-28 -8 -63 -30 -87 -55 -41 -40 -44 -49 -513 -1462 -260 -782 -482 -1455 -495 -1494 l-22 -73 277 0 277 0 423 1275 422 1275 422 0 423 0 83 258 c46 141 86 265 88 275 7 24 -1220 25 -1298 1z" />
            </g>
          </svg>
          <div>
            <span className={s.chip}>{t.chip}</span>
            <h2 className={`${s.h2} ${s.disp}`}>{t.welcome}</h2>
            <p className={s.sub2}>{t.sub2}</p>
          </div>

          {error && (
            <div className={s.error} role="alert">
              {error}
            </div>
          )}
          {notice && (
            <div className={s.foot} style={{ marginTop: 0, marginBottom: 14, textAlign: "start" }}>
              {notice}
            </div>
          )}

          <div className={s.fld}>
            <label htmlFor="u">{t.userL}</label>
            <div className={s.in}>
              <svg viewBox="0 0 24 24">
                <circle cx="12" cy="8" r="4" />
                <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
              </svg>
              <input
                id="u"
                name="username"
                type="text"
                autoComplete="username"
                placeholder={t.userP}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
          </div>

          <div className={s.fld}>
            <label htmlFor="p">{t.passL}</label>
            <div className={s.in}>
              <svg viewBox="0 0 24 24">
                <rect x="4" y="10" width="16" height="10" rx="2" />
                <path d="M8 10V7a4 4 0 0 1 8 0v3" />
              </svg>
              <input
                id="p"
                name="password"
                type={showPw ? "text" : "password"}
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button
                className={s.eye}
                type="button"
                aria-label={showPw ? "Hide password" : "Show password"}
                aria-pressed={showPw}
                onClick={() => setShowPw((v) => !v)}
              >
                <svg viewBox="0 0 24 24">
                  <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z" />
                  <circle cx="12" cy="12" r="2.6" />
                </svg>
              </button>
            </div>
          </div>

          <div className={s.row}>
            <label className={s.remember}>
              <input type="checkbox" name="remember" />
              <span>{t.rem}</span>
            </label>
            <button
              type="button"
              className={s.forgot}
              onClick={() => {
                setError(null);
                setNotice(t.forgotNote);
              }}
            >
              {t.forgot}
            </button>
          </div>

          <button className={s.btn} type="submit" disabled={loading}>
            {loading ? (
              <span className={s.spin} aria-hidden="true" />
            ) : (
              <>
                <span>{t.signin}</span>
                <svg
                  className={s.arrow}
                  width="17"
                  height="17"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.4}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </>
            )}
          </button>

          <div>
            <p className={s.foot}>{t.foot}</p>
            <div className={s.trust}>
              <span>
                <svg viewBox="0 0 24 24">
                  <rect x="4" y="10" width="16" height="10" rx="2" />
                  <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                </svg>
                <i style={{ fontStyle: "normal" }}>{t.t1}</i>
              </span>
              <span>
                <svg viewBox="0 0 24 24">
                  <circle cx="9" cy="8" r="3.2" />
                  <path d="M3 20c1.2-3.2 3.5-4.8 6-4.8s4.8 1.6 6 4.8" />
                  <path d="M16 4a3.2 3.2 0 0 1 0 8M18.5 15.5c1.4.8 2.4 2.3 3 4.5" />
                </svg>
                <i style={{ fontStyle: "normal" }}>{t.t2}</i>
              </span>
              <span>
                <svg viewBox="0 0 24 24">
                  <path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z" />
                  <path d="M9 12l2 2 4-4" />
                </svg>
                <i style={{ fontStyle: "normal" }}>{t.t3}</i>
              </span>
            </div>
          </div>
        </form>
      </main>
    </div>
  );
}
