import {
  ArrowRight,
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  Globe2,
  LockKeyhole,
  Mail,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Sparkles,
  UserPlus,
  UserRound,
  X
} from "lucide-react";
import gsap from "gsap";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { api, type AuthUser } from "../lib/api";
import { clearAuthToken, storeAuthToken } from "../lib/authStorage";
import "./CineHome.css";
import { PublicShowcase, type PublicLocale, type PublicView } from "./PublicShowcase";
import { cineScenes as scenes } from "./cineScenes";
import { getCardPose, nextCardIndex, relativeCardOffset, shouldCorrectDrift, shouldReleasePreparedSlot } from "./cineHomeModel";

interface LoginPageProps {
  onAuthed: (token: string, user: AuthUser) => void;
  variant?: "creator" | "admin";
  initialAuthOpen?: boolean;
  sessionMessage?: string;
}

type AuthMode = "login" | "register";
type Locale = PublicLocale;
const ICP_NUMBER = import.meta.env.VITE_ICP_NUMBER?.trim() || "粤ICP备2026098451号";
const ICP_COMPANY = import.meta.env.VITE_ICP_COMPANY?.trim() || "";
const ICP_REGION = import.meta.env.VITE_ICP_REGION?.trim() || "";
const ICP_YEAR = new Date().getFullYear();

const phonePattern = /^1[3-9]\d{9}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BG_FRAME_TIMEOUT_MS = 8000;

const copy = {
  cn: {
    navHome: "首页",
    navStudio: "创作现场",
    login: "登录",
    register: "注册",
    heroKicker: "BRAND MANIFESTO",
    heroTitle: "灵感即视界",
    heroSubtitle: "让每一次灵感都即时进入镜头",
    start: "开始创作",
    welcome: "欢迎回来",
    createAccount: "创建账号",
    loginIntro: "登录后继续进入 AI 漫剧创作工作台。",
    registerIntro: "注册后即可开始管理作品、积分和生成记录。",
    accountLabel: "手机 / 邮箱 / 用户名",
    accountPlaceholder: "请输入手机号、邮箱或用户名",
    adminAccountPlaceholder: "请输入管理员邮箱",
    password: "密码",
    passwordPlaceholder: "请输入密码",
    captcha: "图形验证码",
    captchaPlaceholder: "请输入图中字符",
    remember: "记住我",
    forgot: "忘记密码?",
    phone: "手机号（选填）",
    phonePlaceholder: "可留空，仅用邮箱注册",
    email: "邮箱",
    emailPlaceholder: "请输入邮箱地址",
    setPassword: "设置密码",
    setPasswordPlaceholder: "至少 6 位",
    confirmPassword: "再次输入密码",
    confirmPasswordPlaceholder: "请再次输入密码",
    agreement: "我已阅读并同意《用户协议》《隐私政策》《内容合规协议》",
    submitLogin: "登录",
    submitRegister: "立即注册",
    submitAdmin: "登录后台",
    loading: "连接中...",
    noAccount: "还没有账户?",
    hasAccount: "已有账户?",
    registerNow: "立即注册",
    backLogin: "返回登录",
    authNote: "登录后可保存作品，生成素材并导出成片。",
    closeAuth: "关闭登录弹窗",
    adminTitle: "后台管理系统",
    adminIntro: "登录后管理用户、积分、兑换码、模型渠道和计费策略。",
    refreshCaptcha: "点击刷新验证码",
    nextScene: "切换下一个镜头"
  },
  en: {
    navHome: "Home",
    navStudio: "Live Studio",
    login: "Log in",
    register: "Sign up",
    heroKicker: "BRAND MANIFESTO",
    heroTitle: "Inspiration In Sight",
    heroSubtitle: "Turn every spark into a cinematic frame",
    start: "Start creating",
    welcome: "Welcome back",
    createAccount: "Create account",
    loginIntro: "Log in to continue your AI comic-drama workspace.",
    registerIntro: "Create an account to manage projects, credits and generation history.",
    accountLabel: "Phone / Email / Username",
    accountPlaceholder: "Enter phone, email or username",
    adminAccountPlaceholder: "Enter admin email",
    password: "Password",
    passwordPlaceholder: "Enter password",
    captcha: "Captcha",
    captchaPlaceholder: "Enter the characters",
    remember: "Remember me",
    forgot: "Forgot password?",
    phone: "Phone (optional)",
    phonePlaceholder: "Optional - email-only signup works",
    email: "Email",
    emailPlaceholder: "Enter email address",
    setPassword: "Set password",
    setPasswordPlaceholder: "At least 6 characters",
    confirmPassword: "Confirm password",
    confirmPasswordPlaceholder: "Enter password again",
    agreement: "I agree to the User Agreement, Privacy Policy and Content Compliance Terms",
    submitLogin: "Log in",
    submitRegister: "Create account",
    submitAdmin: "Admin login",
    loading: "Connecting...",
    noAccount: "No account?",
    hasAccount: "Already have an account?",
    registerNow: "Sign up",
    backLogin: "Back to login",
    authNote: "Sign in to save projects, generate assets and export your film.",
    closeAuth: "Close auth modal",
    adminTitle: "Admin Console",
    adminIntro: "Manage users, credits, redeem codes, model channels and pricing.",
    refreshCaptcha: "Refresh captcha",
    nextScene: "Next scene"
  }
} satisfies Record<Locale, Record<string, string>>;

function createCaptcha() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function stopAndReleaseVideo(video: HTMLVideoElement | null) {
  if (!video) return;
  video.pause();
  video.removeAttribute("src");
  video.load();
}

function waitForDrawableFrame(video: HTMLVideoElement, timeoutMs = BG_FRAME_TIMEOUT_MS) {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
    return Promise.resolve(true);
  }

  return new Promise<boolean>((resolve) => {
    let done = false;
    let frameCallbackId: number | null = null;
    const frameVideo = video as HTMLVideoElement & {
      requestVideoFrameCallback?: (callback: () => void) => number;
      cancelVideoFrameCallback?: (handle: number) => void;
    };
    const finish = (ready: boolean) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      video.removeEventListener("loadeddata", onReady);
      video.removeEventListener("canplay", onReady);
      video.removeEventListener("playing", onReady);
      if (frameCallbackId !== null) frameVideo.cancelVideoFrameCallback?.(frameCallbackId);
      resolve(ready);
    };
    const onReady = () => {
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
        finish(true);
      }
    };
    const timer = window.setTimeout(() => finish(video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0), timeoutMs);
    video.addEventListener("loadeddata", onReady, { once: true });
    video.addEventListener("canplay", onReady, { once: true });
    video.addEventListener("playing", onReady, { once: true });
    frameCallbackId = frameVideo.requestVideoFrameCallback?.(() => finish(true)) ?? null;
  });
}

export function LoginPage({ onAuthed, variant = "creator", initialAuthOpen = false, sessionMessage = "" }: LoginPageProps) {
  const [authOpen, setAuthOpen] = useState(variant === "admin" || initialAuthOpen);
  const [mode, setMode] = useState<AuthMode>("login");
  const [locale, setLocale] = useState<Locale>("cn");
  const [publicView, setPublicView] = useState<PublicView>("home");
  const [languageOpen, setLanguageOpen] = useState(false);
  const [requestedScene, setRequestedScene] = useState(0);
  const [activeScene, setActiveScene] = useState(0);
  const [visibleScene, setVisibleScene] = useState(0);
  const [sceneSourceIndexes, setSceneSourceIndexes] = useState(() => scenes.map(() => 0));
  const [stackExpanded, setStackExpanded] = useState(false);
  const [account, setAccount] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [captcha, setCaptcha] = useState(() => createCaptcha());
  const [captchaInput, setCaptchaInput] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [agree, setAgree] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(sessionMessage);
  const bgRefs = useRef<Array<HTMLVideoElement | null>>([]);
  const visibleBgSlot = useRef<0 | 1>(0);
  const slotSceneIndexes = useRef<[number, number]>([0, 1]);
  const lastBgScene = useRef(0);
  const requestedSceneRef = useRef(0);
  const bgRequestId = useRef(0);
  const visualCardRefs = useRef<Array<HTMLDivElement | null>>([]);
  const hitCardRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const cardVideoRefs = useRef<Array<HTMLVideoElement | null>>([]);
  const stackHoverTimer = useRef<number | null>(null);
  const stackTransitionTimer = useRef<number | null>(null);
  const stackTransitioning = useRef(false);
  const hoveredCardScene = useRef<number | null>(null);

  const isAdmin = variant === "admin";
  const activeMode = isAdmin ? "login" : mode;
  const t = copy[locale];
  const sceneUrls = useMemo(
    () => scenes.map((scene, index) => {
      const sourceIndex = sceneSourceIndexes[index] ?? 0;
      return scene.videoCandidates[Math.min(sourceIndex, scene.videoCandidates.length - 1)] ?? scene.videoUrl;
    }),
    [sceneSourceIndexes]
  );
  const sceneUrlsRef = useRef(sceneUrls);
  sceneUrlsRef.current = sceneUrls;

  const fallbackScene = useCallback((sceneIndex: number, failedSource: string) => {
    setSceneSourceIndexes((current) => {
      const scene = scenes[sceneIndex];
      const currentIndex = current[sceneIndex] ?? 0;
      if (!scene || currentIndex >= scene.videoCandidates.length - 1) return current;
      if (scene.videoCandidates[currentIndex] !== failedSource) return current;
      const next = [...current];
      next[sceneIndex] = currentIndex + 1;
      return next;
    });
  }, []);

  const primeHiddenSlot = useCallback((sceneIndex: number) => {
    const slot = (1 - visibleBgSlot.current) as 0 | 1;
    const video = bgRefs.current[slot];
    const source = sceneUrlsRef.current[sceneIndex];
    if (!video || !source) return;
    slotSceneIndexes.current[slot] = sceneIndex;
    video.poster = scenes[sceneIndex].posterUrl;
    video.preload = "auto";
    if (video.getAttribute("src") !== source) {
      video.src = source;
      video.load();
    }
    video.pause();
  }, []);

  const selectScene = useCallback((index: number) => {
    const nextScene = (index + scenes.length) % scenes.length;
    requestedSceneRef.current = nextScene;
    setActiveScene(nextScene);
    setRequestedScene((current) => (current === nextScene ? current : nextScene));
  }, []);

  function handleCardKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const nextIndex = nextCardIndex(index, event.key === "ArrowRight" ? 1 : -1, scenes.length);
    selectScene(nextIndex);
    hitCardRefs.current[nextIndex]?.focus();
  }

  function handleCardClick(index: number) {
    selectScene(index);
  }

  function handleCardHoverEnter(index: number) {
    if (!stackTransitioning.current || hoveredCardScene.current === null) {
      hoveredCardScene.current = index;
    }
    expandStackWithIntent();
  }

  function handleCardHoverLeave(relatedTarget: EventTarget | null) {
    const next = relatedTarget instanceof HTMLElement
      ? relatedTarget.closest(".cine-card-hit")
      : null;
    if (next) return;
    hoveredCardScene.current = null;
    collapseStack();
  }

  function handleHeroHoverTarget(target: EventTarget) {
    if (target instanceof HTMLElement && target.closest(".cine-card-hit")) return;
    if (stackExpanded) collapseStack();
  }

  const expandStackWithIntent = useCallback(() => {
    if (stackHoverTimer.current !== null) window.clearTimeout(stackHoverTimer.current);
    stackHoverTimer.current = window.setTimeout(() => {
      stackHoverTimer.current = null;
      stackTransitioning.current = true;
      setStackExpanded(true);
      if (stackTransitionTimer.current !== null) window.clearTimeout(stackTransitionTimer.current);
      stackTransitionTimer.current = window.setTimeout(() => {
        stackTransitioning.current = false;
        stackTransitionTimer.current = null;
      }, 550);
    }, 180);
  }, []);

  const collapseStack = useCallback(() => {
    if (stackHoverTimer.current !== null) window.clearTimeout(stackHoverTimer.current);
    if (stackTransitionTimer.current !== null) window.clearTimeout(stackTransitionTimer.current);
    stackHoverTimer.current = null;
    stackTransitionTimer.current = null;
    stackTransitioning.current = false;
    setStackExpanded(false);
  }, []);

  useEffect(() => {
    document.body.classList.add("auth-surface");
    return () => {
      document.body.classList.remove("auth-surface");
      if (stackHoverTimer.current !== null) window.clearTimeout(stackHoverTimer.current);
      if (stackTransitionTimer.current !== null) window.clearTimeout(stackTransitionTimer.current);
    };
  }, []);

  useEffect(() => {
    if (publicView !== "home") return undefined;
    const primary = bgRefs.current[0];
    const secondary = bgRefs.current[1];
    if (!primary) return undefined;

    const sceneIndex = lastBgScene.current;
    const source = sceneUrlsRef.current[sceneIndex];
    let canceled = false;
    const requestId = ++bgRequestId.current;
    const requestStartedAt = performance.now();

    visibleBgSlot.current = 0;
    slotSceneIndexes.current[0] = sceneIndex;
    setVisibleScene(sceneIndex);
    primary.poster = scenes[sceneIndex].posterUrl;
    primary.preload = "auto";
    primary.src = source;
    primary.load();
    void primary.play().catch(() => undefined);
    gsap.set(primary, { autoAlpha: 1, scale: 1 });
    if (secondary) {
      gsap.set(secondary, { autoAlpha: 0, scale: 1.01 });
      stopAndReleaseVideo(secondary);
    }

    void waitForDrawableFrame(primary).then((ready) => {
      if (canceled || bgRequestId.current !== requestId) return;
      if (!ready) {
        console.warn("[cine-media]", { event: "fallback", scene: scenes[sceneIndex].mediaName, source });
        fallbackScene(sceneIndex, source);
        return;
      }
      console.info("[cine-media]", {
        event: "first-frame",
        scene: scenes[sceneIndex].mediaName,
        source,
        waitMs: Math.round(performance.now() - requestStartedAt)
      });
      primeHiddenSlot((sceneIndex + 1) % scenes.length);
    });

    return () => {
      canceled = true;
      bgRequestId.current += 1;
      gsap.killTweensOf(bgRefs.current.filter(Boolean));
      bgRefs.current.forEach((video) => stopAndReleaseVideo(video));
    };
  }, [fallbackScene, primeHiddenSlot, publicView]);

  useEffect(() => {
    if (publicView !== "home") return;
    if (lastBgScene.current === requestedScene) return;

    const sceneIndex = requestedScene;
    const nextScene = scenes[sceneIndex];
    const fromSlot = visibleBgSlot.current;
    const toSlot = (1 - fromSlot) as 0 | 1;
    const fromVideo = bgRefs.current[fromSlot];
    const toVideo = bgRefs.current[toSlot];
    const source = sceneUrls[sceneIndex];
    if (!toVideo || !source) return;

    let canceled = false;
    const requestId = ++bgRequestId.current;
    const requestStartedAt = performance.now();
    gsap.killTweensOf([fromVideo, toVideo].filter(Boolean));
    slotSceneIndexes.current[toSlot] = sceneIndex;
    toVideo.poster = nextScene.posterUrl;
    toVideo.preload = "auto";
    if (toVideo.getAttribute("src") !== source) {
      toVideo.src = source;
      toVideo.load();
    }
    void toVideo.play().catch(() => undefined);
    gsap.set(toVideo, { autoAlpha: 0, scale: 1.006 });

    void waitForDrawableFrame(toVideo).then((ready) => {
      if (canceled || bgRequestId.current !== requestId) return;
      if (!ready) {
        stopAndReleaseVideo(toVideo);
        console.warn("[cine-media]", { event: "fallback", scene: nextScene.mediaName, source });
        const sourceIndex = nextScene.videoCandidates.indexOf(source);
        if (sourceIndex >= 0 && sourceIndex < nextScene.videoCandidates.length - 1) {
          fallbackScene(sceneIndex, source);
        } else {
          requestedSceneRef.current = lastBgScene.current;
          setRequestedScene(lastBgScene.current);
          setActiveScene(lastBgScene.current);
        }
        return;
      }
      visibleBgSlot.current = toSlot;
      lastBgScene.current = sceneIndex;
      setVisibleScene(sceneIndex);
      setActiveScene(sceneIndex);
      console.info("[cine-media]", {
        event: "first-frame",
        scene: nextScene.mediaName,
        source,
        waitMs: Math.round(performance.now() - requestStartedAt)
      });
      gsap.to(toVideo, {
        autoAlpha: 1,
        scale: 1,
        duration: 0.72,
        ease: "power2.out"
      });
      if (fromVideo) {
        gsap.to(fromVideo, {
          autoAlpha: 0,
          duration: 0.72,
          ease: "power2.out",
          onComplete: () => {
            stopAndReleaseVideo(fromVideo);
            primeHiddenSlot((sceneIndex + 1) % scenes.length);
          }
        });
      } else {
        primeHiddenSlot((sceneIndex + 1) % scenes.length);
      }
    });

    return () => {
      canceled = true;
      if (shouldReleasePreparedSlot(visibleBgSlot.current, toSlot)) {
        gsap.killTweensOf(toVideo);
        stopAndReleaseVideo(toVideo);
      }
    };
  }, [fallbackScene, primeHiddenSlot, publicView, requestedScene, sceneUrls]);

  useEffect(() => {
    if (publicView !== "home") return;
    const video = bgRefs.current[visibleBgSlot.current];
    const source = sceneUrls[visibleScene];
    if (!video || !source || video.getAttribute("src") === source) return;

    let canceled = false;
    const requestId = ++bgRequestId.current;
    const requestStartedAt = performance.now();
    slotSceneIndexes.current[visibleBgSlot.current] = visibleScene;
    video.poster = scenes[visibleScene].posterUrl;
    video.preload = "auto";
    video.src = source;
    video.load();
    void video.play().catch(() => undefined);

    void waitForDrawableFrame(video).then((ready) => {
      if (canceled || bgRequestId.current !== requestId) return;
      if (!ready) {
        console.warn("[cine-media]", { event: "fallback", scene: scenes[visibleScene].mediaName, source });
        fallbackScene(visibleScene, source);
        return;
      }
      console.info("[cine-media]", {
        event: "first-frame",
        scene: scenes[visibleScene].mediaName,
        source,
        waitMs: Math.round(performance.now() - requestStartedAt)
      });
      primeHiddenSlot((visibleScene + 1) % scenes.length);
    });

    return () => {
      canceled = true;
    };
  }, [fallbackScene, primeHiddenSlot, publicView, sceneUrls, visibleScene]);

  useEffect(() => {
    if (publicView !== "home") return undefined;
    const animated: Element[] = [];

    scenes.forEach((_scene, index) => {
      const pose = getCardPose(index, activeScene, stackExpanded, scenes.length);
      const visual = visualCardRefs.current[index];
      const hit = hitCardRefs.current[index];
      const targets: HTMLElement[] = [];
      if (visual) targets.push(visual);
      if (hit) targets.push(hit);
      animated.push(...targets);
      gsap.to(targets, {
        x: pose.x,
        y: pose.y,
        z: pose.z,
        rotateY: pose.rotateY,
        rotateZ: pose.rotateZ,
        scale: pose.scale,
        opacity: pose.opacity,
        force3D: true,
        transformPerspective: 1180,
        duration: stackExpanded ? 0.5 : 0.38,
        ease: "power3.out",
        overwrite: true
      });
      if (visual) visual.style.zIndex = String(pose.zIndex);
      if (hit) hit.style.zIndex = String(200 + pose.zIndex);
    });

    return () => gsap.killTweensOf(animated);
  }, [activeScene, publicView, stackExpanded]);

  useEffect(() => {
    if (publicView !== "home") return undefined;
    const background = bgRefs.current[visibleBgSlot.current];
    const card = cardVideoRefs.current[visibleScene];
    if (!background || !card) return undefined;

    const captureVideo = background as HTMLVideoElement & {
      captureStream?: () => MediaStream;
      mozCaptureStream?: () => MediaStream;
    };
    const capture = captureVideo.captureStream ?? captureVideo.mozCaptureStream;
    const stream = capture?.call(captureVideo);

    card.pause();
    card.muted = true;
    if (stream) {
      card.removeAttribute("src");
      card.srcObject = stream;
      void card.play().catch(() => undefined);
    } else {
      card.srcObject = null;
      card.src = scenes[visibleScene].cardVideoUrl;
      card.load();
      const align = () => {
        card.playbackRate = background.playbackRate;
        if (card.readyState >= HTMLMediaElement.HAVE_METADATA && shouldCorrectDrift(background.currentTime, card.currentTime)) {
          card.currentTime = background.currentTime;
        }
      };
      const play = () => {
        align();
        void card.play().catch(() => undefined);
      };
      const pause = () => card.pause();
      align();
      if (!background.paused) void card.play().catch(() => undefined);
      background.addEventListener("play", play);
      background.addEventListener("pause", pause);
      background.addEventListener("seeking", align);
      background.addEventListener("ratechange", align);
      background.addEventListener("timeupdate", align);

      return () => {
        background.removeEventListener("play", play);
        background.removeEventListener("pause", pause);
        background.removeEventListener("seeking", align);
        background.removeEventListener("ratechange", align);
        background.removeEventListener("timeupdate", align);
        stopAndReleaseVideo(card);
      };
    }

    return () => {
      card.pause();
      card.srcObject = null;
    };
  }, [publicView, visibleScene]);

  useEffect(() => {
    cardVideoRefs.current.forEach((video, index) => {
      if (!video || index === visibleScene) return;
      video.pause();
    });
  }, [visibleScene]);

  useEffect(() => {
    if (publicView !== "home") return undefined;
    const handleVisibility = () => {
      if (document.hidden) {
        bgRefs.current.forEach((video) => video?.pause());
        cardVideoRefs.current.forEach((video) => video?.pause());
        return;
      }
      const visible = bgRefs.current[visibleBgSlot.current];
      if (visible) void visible.play().catch(() => undefined);
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [publicView]);

  const switchMode = useCallback((nextMode: AuthMode) => {
    setMode(nextMode);
    setMessage("");
    setCaptcha(createCaptcha());
    setCaptchaInput("");
  }, []);

  function openAuth(nextMode: AuthMode) {
    switchMode(nextMode);
    setAuthOpen(true);
  }

  function clearMessage() {
    if (message) setMessage("");
  }

  function nextScene() {
    selectScene(lastBgScene.current + 1);
  }

  function handleBackgroundEnded(slot: number) {
    if (slot !== visibleBgSlot.current) return;
    if (requestedSceneRef.current !== lastBgScene.current) return;
    const next = nextCardIndex(lastBgScene.current, 1, scenes.length);
    requestedSceneRef.current = next;
    setActiveScene(next);
    setRequestedScene((current) => current === next ? current : next);
  }

  async function submit() {
    const cleanAccount = account.trim();
    const cleanPhone = phone.trim();
    const cleanEmail = email.trim().toLowerCase();
    const cleanCaptcha = captchaInput.trim().toUpperCase();

    if (activeMode === "login" && !cleanAccount) {
      setMessage(locale === "cn" ? "请输入手机号、邮箱或用户名。" : "Please enter phone, email or username.");
      return;
    }
    if (activeMode === "register" && cleanPhone && !phonePattern.test(cleanPhone)) {
      setMessage(locale === "cn" ? "手机号格式不正确；也可以留空，仅用邮箱注册。" : "Invalid phone number; leave it empty to register with email only.");
      return;
    }
    if (activeMode === "register" && !emailPattern.test(cleanEmail)) {
      setMessage(locale === "cn" ? "请输入有效邮箱，后续可用于账号绑定。" : "Please enter a valid email address.");
      return;
    }
    if (cleanCaptcha !== captcha) {
      setMessage(locale === "cn" ? "图形验证码不正确，请重新输入。" : "Captcha is incorrect. Please try again.");
      return;
    }
    if (password.length < 6) {
      setMessage(locale === "cn" ? "密码至少需要 6 位。" : "Password must be at least 6 characters.");
      return;
    }
    if (activeMode === "register" && password !== confirmPassword) {
      setMessage(locale === "cn" ? "两次输入的密码不一致。" : "Passwords do not match.");
      return;
    }
    if (activeMode === "register" && !agree) {
      setMessage(locale === "cn" ? "请先同意用户协议、隐私政策和内容合规协议。" : "Please agree to the terms first.");
      return;
    }

    setLoading(true);
    setMessage("");
    try {
      const result =
        activeMode === "login"
          ? await api.login({ account: cleanAccount, password })
          : await api.register({ phone: cleanPhone || undefined, email: cleanEmail, password });

      if (isAdmin && !["admin", "operator", "finance", "support"].includes(result.user.role)) {
        clearAuthToken();
        throw new Error(locale === "cn" ? "当前账号没有后台管理权限，请使用管理员账号登录。" : "This account has no admin access.");
      }

      storeAuthToken(result.token, remember);
      onAuthed(result.token, result.user);
    } catch (error) {
      setCaptcha(createCaptcha());
      setCaptchaInput("");
      setMessage(error instanceof Error ? error.message : locale === "cn" ? "登录失败，请稍后重试。" : "Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit();
  }

  function captchaField(name: string) {
    return (
      <label className="cine-auth-field">
        <span>{t.captcha}</span>
        <div className="cine-captcha-row">
          <div className="cine-auth-input">
            <ShieldCheck size={18} />
            <input
              autoComplete="off"
              data-lpignore="true"
              name={name}
              value={captchaInput}
              onChange={(event) => {
                setCaptchaInput(event.target.value);
                clearMessage();
              }}
              placeholder={t.captchaPlaceholder}
            />
          </div>
          <button
            className="cine-captcha-image"
            onClick={() => {
              setCaptcha(createCaptcha());
              setCaptchaInput("");
              clearMessage();
            }}
            title={t.refreshCaptcha}
            type="button"
          >
            <span>{captcha}</span>
            <RefreshCw size={14} />
          </button>
        </div>
      </label>
    );
  }

  const authForm = (
    <form className="cine-auth-form" onSubmit={handleSubmit}>
      {activeMode === "login" ? (
        <>
          <label className="cine-auth-field">
            <span>{t.accountLabel}</span>
            <div className="cine-auth-input">
              <UserRound size={18} />
              <input
                autoComplete="username"
                data-lpignore="true"
                name={isAdmin ? "admin_account" : "creator_account"}
                value={account}
                onChange={(event) => {
                  setAccount(event.target.value);
                  clearMessage();
                }}
                placeholder={isAdmin ? t.adminAccountPlaceholder : t.accountPlaceholder}
              />
            </div>
          </label>
          <label className="cine-auth-field">
            <span>{t.password}</span>
            <div className="cine-auth-input">
              <LockKeyhole size={18} />
              <input
                autoComplete="current-password"
                data-lpignore="true"
                name={isAdmin ? "admin_password" : "creator_password"}
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  clearMessage();
                }}
                type={showPassword ? "text" : "password"}
                placeholder={t.passwordPlaceholder}
              />
              <button
                className="cine-password-toggle"
                type="button"
                aria-label={showPassword ? (locale === "cn" ? "隐藏密码" : "Hide password") : (locale === "cn" ? "显示密码" : "Show password")}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((visible) => !visible)}
              >
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </label>
          {captchaField(isAdmin ? "admin_captcha" : "creator_captcha")}
          <div className="cine-form-options">
            <label>
              <input checked={remember} onChange={(event) => setRemember(event.target.checked)} type="checkbox" />
              <span>{t.remember}</span>
            </label>
            <button
              type="button"
              onClick={() =>
                setMessage(locale === "cn" ? "忘记密码时，请向该账号所属平台的管理员申请重置。只有已登录且记得当前密码，才能在个人页修改密码。" : "If you forgot your password, ask the administrator of the platform that manages your account to reset it. You can change it in Profile only when signed in and you know your current password.")
              }
            >
              {t.forgot}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="cine-register-grid">
          <label className="cine-auth-field">
            <span>{t.phone}</span>
            <div className="cine-auth-input">
              <Smartphone size={18} />
              <input
                autoComplete="off"
                data-lpignore="true"
                inputMode="tel"
                name="register_phone"
                value={phone}
                onChange={(event) => {
                  setPhone(event.target.value);
                  clearMessage();
                }}
                placeholder={t.phonePlaceholder}
              />
            </div>
          </label>
          <label className="cine-auth-field">
            <span>{t.email}</span>
            <div className="cine-auth-input">
              <Mail size={18} />
              <input
                autoComplete="off"
                data-lpignore="true"
                name="register_email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  clearMessage();
                }}
                placeholder={t.emailPlaceholder}
              />
            </div>
          </label>
          </div>
          <div className="cine-register-full">{captchaField("register_captcha")}</div>
          <div className="cine-register-grid">
          <label className="cine-auth-field">
            <span>{t.setPassword}</span>
            <div className="cine-auth-input">
              <LockKeyhole size={18} />
              <input
                autoComplete="new-password"
                data-lpignore="true"
                name="register_password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  clearMessage();
                }}
                type={showPassword ? "text" : "password"}
                placeholder={t.setPasswordPlaceholder}
              />
              <button
                className="cine-password-toggle"
                type="button"
                aria-label={showPassword ? (locale === "cn" ? "隐藏密码" : "Hide password") : (locale === "cn" ? "显示密码" : "Show password")}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((visible) => !visible)}
              >
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </label>
          <label className="cine-auth-field">
            <span>{t.confirmPassword}</span>
            <div className="cine-auth-input">
              <LockKeyhole size={18} />
              <input
                autoComplete="new-password"
                data-lpignore="true"
                name="register_confirm_password"
                value={confirmPassword}
                onChange={(event) => {
                  setConfirmPassword(event.target.value);
                  clearMessage();
                }}
                type={showConfirmPassword ? "text" : "password"}
                placeholder={t.confirmPasswordPlaceholder}
              />
              <button
                className="cine-password-toggle"
                type="button"
                aria-label={showConfirmPassword ? (locale === "cn" ? "隐藏确认密码" : "Hide confirmation password") : (locale === "cn" ? "显示确认密码" : "Show confirmation password")}
                aria-pressed={showConfirmPassword}
                onClick={() => setShowConfirmPassword((visible) => !visible)}
              >
                {showConfirmPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </label>
          </div>
          <label className="cine-agree-row">
            <input checked={agree} onChange={(event) => setAgree(event.target.checked)} type="checkbox" />
            <span>{t.agreement}</span>
          </label>
        </>
      )}

      <button className="cine-submit-button" disabled={loading} type="submit">
        {loading ? t.loading : isAdmin ? t.submitAdmin : activeMode === "login" ? t.submitLogin : t.submitRegister}
        <ArrowRight size={17} />
      </button>
      {message ? <p className="cine-auth-message">{message}</p> : null}
    </form>
  );

  if (isAdmin) {
    return (
      <main className="cine-admin-login-page">
        <section className="cine-admin-login-card">
          <div className="cine-logo-text">
            <span>漫角</span>
            <small>MANJIAO.CLOUD</small>
          </div>
          <h1>{t.adminTitle}</h1>
          <p>{t.adminIntro}</p>
          {authForm}
        </section>
      </main>
    );
  }

  return (
    <main className={`cine-home-page relative w-screen bg-black text-white ${publicView === "home" ? "" : "cine-scroll-page"}`}>
      <nav className={`cine-top-nav ${publicView === "home" ? "" : "solid"}`} aria-label="首页导航">
        <button className="cine-logo-text nav-logo" type="button" onClick={() => setPublicView("home")}>
          <span>漫角</span>
          <small>MANJIAO.CLOUD</small>
        </button>
        <div className="cine-nav-links">
          <button className={publicView === "home" ? "active" : ""} type="button" onClick={() => setPublicView("home")}>{t.navHome}</button>
          <button className={publicView === "studio" ? "active" : ""} type="button" onClick={() => setPublicView("studio")}>{t.navStudio}</button>
        </div>
        <div className="cine-nav-actions">
          <div className="cine-language">
            <button
              className={languageOpen ? "open" : undefined}
              type="button"
              onClick={() => setLanguageOpen((value) => !value)}
            >
              <Globe2 size={15} />
              {locale === "cn" ? "CN" : "EN"}
              <ChevronDown size={14} />
            </button>
            {languageOpen ? (
              <div className="cine-language-menu">
                <button className={locale === "cn" ? "active" : undefined} type="button" onClick={() => { setLocale("cn"); setLanguageOpen(false); }}>
                  <span />
                  中文
                </button>
                <button className={locale === "en" ? "active" : undefined} type="button" onClick={() => { setLocale("en"); setLanguageOpen(false); }}>
                  <span />
                  English
                </button>
              </div>
            ) : null}
          </div>
          <button className="cine-login-pill" type="button" onClick={() => openAuth("login")}>
            {t.login}
          </button>
        </div>
      </nav>

      {publicView === "home" ? <section
        className="cine-hero relative w-screen overflow-hidden"
        aria-label="漫角电影感首页"
        onMouseMove={(event) => handleHeroHoverTarget(event.target)}
        onPointerMove={(event) => handleHeroHoverTarget(event.target)}
      >
        <div className="cine-video-layer absolute inset-0" aria-hidden="true">
          {[0, 1].map((slot) => (
            <video
              className="cine-bg-buffer absolute inset-0 h-full w-full object-cover"
              key={slot}
              muted
              playsInline
              preload={slot === 0 ? "metadata" : "none"}
              poster={slot === 0 ? scenes[0].posterUrl : undefined}
              disablePictureInPicture
              onEnded={() => handleBackgroundEnded(slot)}
              onError={(event) => {
                const sceneIndex = slotSceneIndexes.current[slot];
                const failedSource = event.currentTarget.getAttribute("src") ?? event.currentTarget.currentSrc;
                if (failedSource) fallbackScene(sceneIndex, failedSource);
              }}
              ref={(node) => {
                bgRefs.current[slot] = node;
              }}
            />
          ))}
          <div className="cine-radial-glow" />
          <div className="cine-bottom-gradient" />
          <div className="cine-left-gradient" />
        </div>

        <div className="cine-center-copy">
          <p>{t.heroKicker}</p>
          <h1>{t.heroTitle}</h1>
          <span>{t.heroSubtitle}</span>
        </div>

        <div
          className={`cine-card-stack ${stackExpanded ? "expanded" : "collapsed"}`}
          aria-label="CINE CAM 3D 视频卡片堆叠"
          onPointerEnter={expandStackWithIntent}
          onPointerMove={(event) => {
            const hit = (event.target as HTMLElement).closest<HTMLButtonElement>(".cine-card-hit");
            if (!hit) return;
            const index = Number(hit.dataset.sceneIndex);
            if (Number.isInteger(index)) hoveredCardScene.current = index;
          }}
          onPointerLeave={() => {
            hoveredCardScene.current = null;
            collapseStack();
          }}
          onFocusCapture={() => {
            if (stackHoverTimer.current !== null) window.clearTimeout(stackHoverTimer.current);
            stackHoverTimer.current = null;
            stackTransitioning.current = true;
            setStackExpanded(true);
            if (stackTransitionTimer.current !== null) window.clearTimeout(stackTransitionTimer.current);
            stackTransitionTimer.current = window.setTimeout(() => {
              stackTransitioning.current = false;
              stackTransitionTimer.current = null;
            }, 550);
          }}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) collapseStack();
          }}
        >
          <div className="cine-card-visual-layer" aria-hidden="true">
            {scenes.map((scene, index) => {
              const isActive = index === activeScene;
              return (
                <div
                  className={isActive ? "cine-film-card cine-card-visual active" : "cine-film-card cine-card-visual"}
                  key={`visual-${scene.id}`}
                  ref={(node) => {
                    visualCardRefs.current[index] = node;
                  }}
                >
                  <video
                    className="cine-card-media"
                    poster={scene.posterUrl}
                    muted
                    playsInline
                    preload="none"
                    disablePictureInPicture
                    onError={(event) => {
                      event.currentTarget.pause();
                      event.currentTarget.removeAttribute("src");
                      event.currentTarget.load();
                    }}
                    ref={(node) => {
                      cardVideoRefs.current[index] = node;
                    }}
                  />
                  <div className="cine-card-overlay" />
                  <div className="cine-card-sheen" />
                  <div className="cine-card-corners" />
                  <div className="cine-card-head">
                    <span>{scene.eyebrow}</span>
                    {isActive ? <b>{scene.activeLabel ?? "REC"}</b> : null}
                  </div>
                  <div className="cine-card-body">
                    <p>{scene.meta}</p>
                    <strong>{scene.title[locale]}</strong>
                    {isActive ? <small>00:00:00:00</small> : null}
                  </div>
                  {isActive ? (
                    <div className="cine-active-scan-ui">
                      <i />
                      <span>{scene.scanLabel[locale]}</span>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          <div className="cine-card-hit-layer">
            {scenes.map((scene, index) => {
              const offset = relativeCardOffset(index, activeScene, scenes.length);
              return (
                <button
                  className="cine-card-hit"
                  data-offset={offset}
                  data-scene-index={index}
                  key={`hit-${scene.id}`}
                  type="button"
                  aria-label={`切换到${scene.title[locale]}`}
                  aria-pressed={index === activeScene}
                  onClick={() => handleCardClick(index)}
                  onPointerEnter={() => handleCardHoverEnter(index)}
                  onPointerLeave={(event) => handleCardHoverLeave(event.relatedTarget)}
                  onMouseEnter={() => handleCardHoverEnter(index)}
                  onMouseMove={() => handleCardHoverEnter(index)}
                  onMouseLeave={(event) => handleCardHoverLeave(event.relatedTarget)}
                  onKeyDown={(event) => handleCardKeyDown(event, index)}
                  ref={(node) => {
                    hitCardRefs.current[index] = node;
                  }}
                />
              );
            })}
          </div>
        </div>

        <div className="cine-side-control">
          <span>manjiao</span>
          <button type="button" aria-label={t.nextScene} onClick={nextScene}>
            <ArrowRight size={22} />
          </button>
        </div>

        <button className="cine-mobile-start" type="button" onClick={() => openAuth("login")}>
          <Sparkles size={16} />
          {t.start}
        </button>
      </section> : <PublicShowcase locale={locale} scenes={scenes} view={publicView} onStart={() => openAuth("login")} />}

      <span className="cine-icp-line">© {ICP_YEAR} 漫角 manjiao.cloud · <a className="cine-icp-link" href="https://beian.miit.gov.cn/" target="_blank" rel="noreferrer">{ICP_NUMBER}</a>{ICP_COMPANY ? ` · ${ICP_COMPANY}` : ""}{ICP_REGION ? ` · ${ICP_REGION}` : ""}</span>

      {authOpen ? (
        <div className="cine-auth-modal" role="dialog" aria-modal="true" aria-label={activeMode === "login" ? t.login : t.register}>
          <button className="cine-auth-backdrop" type="button" aria-label={t.closeAuth} onClick={() => setAuthOpen(false)} />
          <section className={`cine-auth-card ${activeMode === "register" ? "register-mode" : "login-mode"}`}>
            <button className="cine-auth-close" type="button" aria-label="关闭" onClick={() => setAuthOpen(false)}>
              <X size={18} />
            </button>
            <div className="cine-auth-brand">
              <div className="cine-logo-text">
                <span>漫角</span>
                <small>MANJIAO.CLOUD</small>
              </div>
              <h2>{activeMode === "login" ? t.welcome : t.createAccount}</h2>
              <p>{activeMode === "login" ? t.loginIntro : t.registerIntro}</p>
            </div>
            <div className="cine-auth-tabs">
              <button className={activeMode === "login" ? "active" : undefined} type="button" onClick={() => switchMode("login")}>
                {t.login}
              </button>
              <button className={activeMode === "register" ? "active" : undefined} type="button" onClick={() => switchMode("register")}>
                <UserPlus size={15} />
                {t.register}
              </button>
            </div>
            {authForm}
            <div className="cine-auth-bottom">
              {activeMode === "login" ? (
                <span>
                  {t.noAccount}
                  <button type="button" onClick={() => switchMode("register")}>{t.registerNow}</button>
                </span>
              ) : (
                <span>
                  {t.hasAccount}
                  <button type="button" onClick={() => switchMode("login")}>{t.backLogin}</button>
                </span>
              )}
              <small>
                <Check size={13} />
                {t.authNote}
              </small>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
