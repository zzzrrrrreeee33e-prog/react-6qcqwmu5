import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './supabaseClient';

/* =========================================================
 * أدوات مساعدة للتاريخ/الوقت بتوقيت العراق (Asia/Baghdad = UTC+3 دائماً)
 * ========================================================= */

const ARABIC_WEEKDAYS = [
  'الأحد',
  'الاثنين',
  'الثلاثاء',
  'الأربعاء',
  'الخميس',
  'الجمعة',
  'السبت',
];

function getBaghdadDateString(refDate = new Date()) {
  // ياخذ Date عادي، ويرجع تاريخه المحلي ببغداد كنص YYYY-MM-DD
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Baghdad',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(refDate);
  const map = {};
  parts.forEach((p) => (map[p.type] = p.value));
  return `${map.year}-${map.month}-${map.day}`;
}

function isValidDateString(dateStr) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(dateStr) &&
    !isNaN(new Date(dateStr + 'T00:00:00Z').getTime())
  );
}

function addDaysToDateString(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function toBaghdadInstant(dateStr, timeStr) {
  // timeStr مثل "16:00" أو "16:00:00"
  const hhmm = timeStr.length >= 5 ? timeStr.slice(0, 5) : timeStr;
  return new Date(`${dateStr}T${hhmm}:00+03:00`);
}

function arabicWeekdayFromDateString(dateStr) {
  const dow = new Date(dateStr + 'T00:00:00Z').getUTCDay();
  return ARABIC_WEEKDAYS[dow];
}

function formatArabicDateDMY(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

function getBaghdadHM(date) {
  const s = date.toLocaleString('en-GB', {
    timeZone: 'Asia/Baghdad',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const [h, m] = s.split(':').map(Number);
  return { hour: h, minute: m };
}

function formatArabicTime12h(date) {
  const { hour, minute } = getBaghdadHM(date);
  const period = hour >= 12 ? 'مساءً' : 'صباحاً';
  let hour12 = hour % 12;
  if (hour12 === 0) hour12 = 12;
  const mm = String(minute).padStart(2, '0');
  return `${hour12}:${mm} ${period}`;
}

function formatDurationLabel(minutes) {
  if (minutes === 60) return 'ساعة واحدة';
  if (minutes % 60 === 0) return `${minutes / 60} ساعات`;
  return `${minutes} دقيقة`;
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function friendlyErrorMessage(error) {
  const msg = error && error.message ? String(error.message) : '';
  // نتائج دوال RPC عندنا (create_booking, cancel_my_booking...) ترجع
  // برسائل عربية واضحة أصلاً — نعرضها كما هي. أي خطأ تقني غامض
  // (شبكة، undefined، إلخ) يُستبدل برسالة عامة مفهومة.
  if (
    !msg ||
    (/fetch|network|undefined|null|50\d|stack/i.test(msg) &&
      !/[\u0600-\u06FF]/.test(msg))
  ) {
    return 'حدث خطأ أثناء إنشاء الحجز، حاول مرة أخرى.';
  }
  return msg;
}

function money(n) {
  return Number(n || 0).toLocaleString('ar-IQ');
}

/* =========================================================
 * توليد قائمة الأوقات (Slots) من نتيجة get_court_availability
 * ========================================================= */
function generateSlots(availability, dateStr) {
  if (!availability || !isValidDateString(dateStr)) return [];
  const duration = availability.duration_minutes;
  const windowStart = toBaghdadInstant(dateStr, availability.opens_at);
  const windowEnd = availability.is_overnight
    ? toBaghdadInstant(addDaysToDateString(dateStr, 1), availability.closes_at)
    : toBaghdadInstant(dateStr, availability.closes_at);

  const now = new Date();
  const slots = [];
  let cursor = new Date(windowStart);

  while (true) {
    const end = new Date(cursor.getTime() + duration * 60000);
    if (end > windowEnd) break;

    let status = 'available';
    if (cursor < now) {
      status = 'past';
    } else {
      for (const b of availability.booked_ranges || []) {
        const bs = new Date(b.starts_at);
        const be = new Date(b.ends_at);
        if (cursor < be && end > bs) {
          status = 'booked';
          break;
        }
      }
    }

    slots.push({ start: new Date(cursor), end, status });
    cursor = end;
  }

  return slots;
}

/* =========================================================
 * المكوّن الرئيسي
 * ========================================================= */
function App() {
  /* ---------- الساعة الحية ---------- */
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  /* ---------- الإعدادات العامة ---------- */
  const [settings, setSettings] = useState(null);

  /* ---------- الملاعب (عرض عام) ---------- */
  const [courts, setCourts] = useState([]);
  const [courtsLoading, setCourtsLoading] = useState(true);
  const [courtsError, setCourtsError] = useState(null);

  async function loadPublicCourts() {
    const { data, error } = await supabase
      .from('public_courts')
      .select('*')
      .order('name', { ascending: true });
    if (error) setCourtsError(error.message);
    else {
      setCourts(data);
      setCourtsError(null);
    }
    setCourtsLoading(false);
  }

  useEffect(() => {
    loadPublicCourts();

    supabase
      .from('settings')
      .select('*')
      .eq('id', 1)
      .single()
      .then(({ data }) => setSettings(data));
  }, []);

  /* =========================================================
   * نافذة الحجز
   * ========================================================= */
  const [bookingCourt, setBookingCourt] = useState(null); // الملعب الجاري حجزه
  const [bookingDate, setBookingDate] = useState(getBaghdadDateString());
  const [availability, setAvailability] = useState(null);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [bookingStep, setBookingStep] = useState('slots'); // slots -> form -> review -> success
  const [custName, setCustName] = useState('');
  const [custPhone, setCustPhone] = useState('');
  const [custEmail, setCustEmail] = useState('');
  const [custNotes, setCustNotes] = useState('');
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [bookingResult, setBookingResult] = useState(null);
  const submittingRef = useRef(false);

  async function loadAvailability(courtId, dateStr) {
    setAvailabilityLoading(true);
    const { data, error } = await supabase.rpc('get_court_availability', {
      p_court_id: courtId,
      p_date: dateStr,
    });
    if (!error && data && data[0]) {
      setAvailability(data[0]);
    } else {
      setAvailability(null);
    }
    setAvailabilityLoading(false);
  }

  function openBooking(court) {
    setBookingCourt(court);
    setBookingDate(getBaghdadDateString());
    setBookingStep('slots');
    setSelectedSlot(null);
    setBookingResult(null);
    setSubmitError(null);
    setFormError(null);
    setCustName('');
    setCustPhone('');
    setCustEmail('');
    setCustNotes('');
  }

  function closeBooking() {
    setBookingCourt(null);
  }

  useEffect(() => {
    if (bookingCourt) {
      loadAvailability(bookingCourt.id, bookingDate);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingCourt, bookingDate]);

  // تحديث فوري (Realtime): إذا حجز أي شخص آخر وقتاً لهذا الملعب أثناء
  // فتح النافذة، تُعاد قراءة الأوقات المتاحة تلقائياً بدون Refresh.
  useEffect(() => {
    if (!bookingCourt) return;
    const channel = supabase
      .channel('public-events-' + bookingCourt.id)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'public_booking_events',
          filter: `court_id=eq.${bookingCourt.id}`,
        },
        () => loadAvailability(bookingCourt.id, bookingDate)
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingCourt, bookingDate]);

  const slots = useMemo(
    () => generateSlots(availability, bookingDate),
    [availability, bookingDate]
  );

  function pickSlot(slot) {
    if (slot.status !== 'available') return;
    setSelectedSlot(slot);
    setBookingStep('form');
  }

  function validateForm() {
    if (!custName || custName.trim().length < 2)
      return 'يرجى إدخال الاسم الكامل.';
    if (!custPhone || custPhone.trim().length < 7)
      return 'يرجى إدخال رقم الهاتف.';
    if (custEmail && !isValidEmail(custEmail))
      return 'صيغة البريد الإلكتروني غير صحيحة.';
    return null;
  }

  function goToReview(e) {
    e.preventDefault();
    const err = validateForm();
    if (err) {
      setFormError(err);
      return;
    }
    setFormError(null);
    setBookingStep('review');
  }

  async function confirmBooking() {
    if (submittingRef.current) return; // حماية من الضغط المتكرر
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError(null);

    const { data, error } = await supabase.rpc('create_booking', {
      p_court_id: bookingCourt.id,
      p_starts_at: selectedSlot.start.toISOString(),
      p_customer_name: custName.trim(),
      p_phone: custPhone.trim(),
      p_email: custEmail.trim() || null,
      p_notes: custNotes.trim() || null,
    });

    submittingRef.current = false;
    setSubmitting(false);

    if (error) {
      setSubmitError(friendlyErrorMessage(error));
      // الوقت قد يكون أصبح محجوزاً للتو من شخص آخر — نحدّث القائمة فوراً
      loadAvailability(bookingCourt.id, bookingDate);
      return;
    }

    setBookingResult(data[0]);
    setBookingStep('success');
  }

  function whatsappMessage() {
    const r = bookingResult;
    const lines = [
      `حجز جديد - ${settings?.business_name || 'ملاعب كابتن نديم'}`,
      '',
      'رقم الحجز:',
      r.out_booking_number,
      '',
      'الاسم:',
      custName,
      '',
      'رقم الهاتف:',
      custPhone,
      ...(custEmail ? ['', 'البريد الإلكتروني:', custEmail] : []),
      '',
      'الملعب:',
      bookingCourt.name,
      '',
      'اليوم:',
      arabicWeekdayFromDateString(bookingDate),
      '',
      'التاريخ:',
      formatArabicDateDMY(bookingDate),
      '',
      'الوقت:',
      formatArabicTime12h(selectedSlot.start),
      '',
      'المدة:',
      formatDurationLabel(availability.duration_minutes),
      '',
      'السعر:',
      money(r.out_price) + ' د.ع',
    ];
    return lines.join('\n');
  }

  function whatsappLink() {
    const number = settings?.whatsapp_number || '';
    return `https://wa.me/${number}?text=${encodeURIComponent(
      whatsappMessage()
    )}`;
  }

  /* =========================================================
   * البحث عن حجزي
   * ========================================================= */
  const [searchNumber, setSearchNumber] = useState('');
  const [searchPhone, setSearchPhone] = useState('');
  const [searchResult, setSearchResult] = useState(null);
  const [searchError, setSearchError] = useState(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [cancelMsg, setCancelMsg] = useState(null);

  async function handleSearchBooking(e) {
    e.preventDefault();
    setSearchLoading(true);
    setSearchError(null);
    setSearchResult(null);
    setCancelMsg(null);

    const { data, error } = await supabase.rpc('get_booking_status', {
      p_booking_number: searchNumber.trim(),
      p_phone: searchPhone.trim(),
    });

    setSearchLoading(false);

    if (error || !data || data.length === 0) {
      setSearchError('لم يتم العثور على نتائج.');
      return;
    }
    setSearchResult(data[0]);
  }

  async function handleSelfCancel() {
    setCancelMsg(null);
    const { data, error } = await supabase.rpc('cancel_my_booking', {
      p_booking_number: searchResult.out_booking_number,
      p_phone: searchPhone.trim(),
    });
    if (error) {
      setCancelMsg({ ok: false, text: friendlyErrorMessage(error) });
      return;
    }
    setCancelMsg({ ok: true, text: data });
    setSearchResult({ ...searchResult, out_status: 'cancelled' });
  }

  /* =========================================================
   * الإدارة: تسجيل الدخول + الصلاحية
   * ========================================================= */
  const [session, setSession] = useState(null);
  const [role, setRole] = useState(null); // 'admin' | 'staff' | null
  const [showLogin, setShowLogin] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState(null);
  const [loginLoading, setLoginLoading] = useState(false);
  const [showAdminPanel, setShowAdminPanel] = useState(false);

  async function checkRole(currentSession) {
    if (!currentSession) {
      setRole(null);
      return;
    }
    const { data } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', currentSession.user.id)
      .single();
    setRole(data ? data.role : null);
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      checkRole(data.session);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      checkRole(s);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  const isStaffOrAdmin = role === 'admin' || role === 'staff';

  async function handleLogin(e) {
    e.preventDefault();
    setLoginLoading(true);
    setLoginError(null);
    const { error } = await supabase.auth.signInWithPassword({
      email: loginEmail,
      password: loginPassword,
    });
    setLoginLoading(false);
    if (error) {
      setLoginError('بيانات الدخول غير صحيحة.');
      return;
    }
    setShowLogin(false);
    setLoginEmail('');
    setLoginPassword('');
    setShowAdminPanel(true);
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    setShowAdminPanel(false);
  }

  /* =========================================================
   * لوحة الإدارة
   * ========================================================= */
  const [adminTab, setAdminTab] = useState('dashboard'); // dashboard | bookings | courts
  const [adminCourts, setAdminCourts] = useState([]);
  const [todayBookings, setTodayBookings] = useState([]);
  const [stats, setStats] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const unreadCount = notifications.filter((n) => !n.is_read).length;

  async function loadAdminCourts() {
    const { data } = await supabase.from('courts').select('*').order('name');
    if (data) setAdminCourts(data);
  }

  async function loadNotifications() {
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(30);
    if (data) setNotifications(data);
  }

  async function markNotificationsRead() {
    setShowNotifications((v) => !v);
    const unread = notifications.filter((n) => !n.is_read).map((n) => n.id);
    if (unread.length > 0) {
      await supabase
        .from('notifications')
        .update({ is_read: true })
        .in('id', unread);
      loadNotifications();
    }
  }

  async function loadDashboard() {
    const todayStr = getBaghdadDateString();
    const dayStart = toBaghdadInstant(todayStr, '00:00').toISOString();
    const dayEnd = toBaghdadInstant(
      addDaysToDateString(todayStr, 1),
      '00:00'
    ).toISOString();
    const monthStr = todayStr.slice(0, 7) + '-01';
    const nextMonthStr = addDaysToDateString(monthStr, 32).slice(0, 7) + '-01';
    const monthStart = toBaghdadInstant(monthStr, '00:00').toISOString();
    const monthEnd = toBaghdadInstant(nextMonthStr, '00:00').toISOString();

    const { data: todayRows } = await supabase
      .from('bookings')
      .select('*, courts(name)')
      .gte('starts_at', dayStart)
      .lt('starts_at', dayEnd)
      .order('starts_at', { ascending: true });

    const { data: upcomingRows } = await supabase
      .from('bookings')
      .select('id', { count: 'exact', head: false })
      .in('status', ['new', 'confirmed'])
      .gt('starts_at', new Date().toISOString());

    const { data: monthRows } = await supabase
      .from('bookings')
      .select('price_at_booking, status')
      .gte('starts_at', monthStart)
      .lt('starts_at', monthEnd);

    const nowIso = new Date();
    const rows = todayRows || [];
    const todayRevenue = rows
      .filter((b) => ['new', 'confirmed', 'completed'].includes(b.status))
      .reduce((s, b) => s + Number(b.price_at_booking), 0);
    const monthRevenue = (monthRows || [])
      .filter((b) => ['new', 'confirmed', 'completed'].includes(b.status))
      .reduce((s, b) => s + Number(b.price_at_booking), 0);

    const busyCourtIds = new Set(
      rows
        .filter(
          (b) =>
            ['new', 'confirmed'].includes(b.status) &&
            new Date(b.starts_at) <= nowIso &&
            new Date(b.ends_at) > nowIso
        )
        .map((b) => b.court_id)
    );

    setTodayBookings(rows);
    setStats({
      todayCount: rows.length,
      upcomingCount: (upcomingRows || []).length,
      todayCompleted: rows.filter((b) => b.status === 'completed').length,
      todayCancelled: rows.filter((b) => b.status === 'cancelled').length,
      todayRevenue,
      monthRevenue,
      courtsBusyNow: busyCourtIds.size,
      courtsAvailableNow:
        adminCourts.filter((c) => c.is_active).length - busyCourtIds.size,
    });
  }

  useEffect(() => {
    if (showAdminPanel && isStaffOrAdmin) {
      loadAdminCourts();
      loadNotifications();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAdminPanel, isStaffOrAdmin]);

  useEffect(() => {
    if (showAdminPanel && isStaffOrAdmin && adminCourts.length >= 0) {
      loadDashboard();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAdminPanel, isStaffOrAdmin, adminCourts]);

  // Realtime للإدارة: أي حجز أو إشعار جديد يظهر فوراً بدون Refresh
  useEffect(() => {
    if (!showAdminPanel || !isStaffOrAdmin) return;
    const channel = supabase
      .channel('admin-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bookings' },
        () => loadDashboard()
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications' },
        () => loadNotifications()
      )
      .subscribe();
    return () => supabase.removeChannel(channel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAdminPanel, isStaffOrAdmin]);

  /* ---------- إدارة الملاعب: السعر / الحالة ---------- */
  const [priceDrafts, setPriceDrafts] = useState({});
  const [savingCourtId, setSavingCourtId] = useState(null);
  const [closeReasonDrafts, setCloseReasonDrafts] = useState({});

  async function savePrice(court) {
    const raw = priceDrafts[court.id];
    const value = Number(raw);
    if (!raw || isNaN(value) || value < 0) {
      alert('الرجاء إدخال سعر صحيح.');
      return;
    }
    setSavingCourtId(court.id);
    const { error } = await supabase
      .from('courts')
      .update({ price: value })
      .eq('id', court.id);
    setSavingCourtId(null);
    if (error) {
      alert(friendlyErrorMessage(error));
      return;
    }
    setPriceDrafts((p) => {
      const n = { ...p };
      delete n[court.id];
      return n;
    });
    loadAdminCourts();
    loadPublicCourts();
  }

  async function toggleCourtStatus(court) {
    const newActive = !court.is_active;
    const reason = newActive ? null : closeReasonDrafts[court.id] || null;
    const { error } = await supabase
      .from('courts')
      .update({ is_active: newActive, inactive_reason: reason })
      .eq('id', court.id);
    if (error) {
      alert(friendlyErrorMessage(error));
      return;
    }
    loadAdminCourts();
    loadPublicCourts();
  }

  /* ---------- الحجوزات والتقارير (بحث + فلترة + تقرير + تصدير) ---------- */
  const [reportFrom, setReportFrom] = useState(getBaghdadDateString());
  const [reportTo, setReportTo] = useState(getBaghdadDateString());
  const [filterCourt, setFilterCourt] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [searchText, setSearchText] = useState('');
  const [reportRows, setReportRows] = useState([]);
  const [reportLoading, setReportLoading] = useState(false);

  async function runReport() {
    setReportLoading(true);
    const start = toBaghdadInstant(reportFrom, '00:00').toISOString();
    const end = toBaghdadInstant(
      addDaysToDateString(reportTo, 1),
      '00:00'
    ).toISOString();

    let query = supabase
      .from('bookings')
      .select('*, courts(name)')
      .gte('starts_at', start)
      .lt('starts_at', end)
      .order('starts_at', { ascending: false });

    if (filterCourt !== 'all') query = query.eq('court_id', filterCourt);
    if (filterStatus !== 'all') query = query.eq('status', filterStatus);

    const { data, error } = await query;
    setReportLoading(false);
    if (!error && data) {
      const text = searchText.trim().toLowerCase();
      const filtered = text
        ? data.filter(
            (b) =>
              b.customer_name.toLowerCase().includes(text) ||
              b.phone.includes(text) ||
              b.booking_number.toLowerCase().includes(text)
          )
        : data;
      setReportRows(filtered);
    }
  }

  useEffect(() => {
    if (showAdminPanel && isStaffOrAdmin && adminTab === 'bookings') {
      runReport();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAdminPanel, isStaffOrAdmin, adminTab]);

  const reportSummary = useMemo(() => {
    const validRows = reportRows.filter((b) =>
      ['new', 'confirmed', 'completed'].includes(b.status)
    );
    const revenue = validRows.reduce(
      (s, b) => s + Number(b.price_at_booking),
      0
    );
    const completed = reportRows.filter((b) => b.status === 'completed').length;
    const cancelled = reportRows.filter((b) => b.status === 'cancelled').length;

    const courtCounts = {};
    const dayCounts = {};
    const hourCounts = {};
    reportRows.forEach((b) => {
      const cname = b.courts?.name || '—';
      courtCounts[cname] = (courtCounts[cname] || 0) + 1;
      const dateStr = getBaghdadDateString(new Date(b.starts_at));
      const dayName = arabicWeekdayFromDateString(dateStr);
      dayCounts[dayName] = (dayCounts[dayName] || 0) + 1;
      const { hour } = getBaghdadHM(new Date(b.starts_at));
      hourCounts[hour] = (hourCounts[hour] || 0) + 1;
    });
    const top = (obj) => {
      const entries = Object.entries(obj);
      if (entries.length === 0) return '—';
      return entries.sort((a, b) => b[1] - a[1])[0][0];
    };

    return {
      count: reportRows.length,
      revenue,
      completed,
      cancelled,
      busiestCourt: top(courtCounts),
      busiestDay: top(dayCounts),
      busiestHour:
        hourCounts && Object.keys(hourCounts).length
          ? `${top(hourCounts)}:00`
          : '—',
    };
  }, [reportRows]);

  async function changeStatus(booking, newStatus) {
    const { error } = await supabase
      .from('bookings')
      .update({ status: newStatus })
      .eq('id', booking.id);
    if (error) {
      alert(friendlyErrorMessage(error));
      return;
    }
    runReport();
    loadDashboard();
  }

  function exportCSV() {
    const headers = [
      'رقم الحجز',
      'اسم العميل',
      'رقم الهاتف',
      'البريد الإلكتروني',
      'الملعب',
      'التاريخ',
      'اليوم',
      'الوقت',
      'المدة (دقيقة)',
      'السعر',
      'الحالة',
      'تاريخ الإنشاء',
    ];
    const rows = reportRows.map((b) => {
      const dateStr = getBaghdadDateString(new Date(b.starts_at));
      return [
        b.booking_number,
        b.customer_name,
        b.phone,
        b.email,
        b.courts?.name || '',
        formatArabicDateDMY(dateStr),
        arabicWeekdayFromDateString(dateStr),
        formatArabicTime12h(new Date(b.starts_at)),
        b.duration_minutes,
        b.price_at_booking,
        b.status,
        new Date(b.created_at).toLocaleString('ar-IQ'),
      ];
    });
    const csv = [headers, ...rows]
      .map((r) =>
        r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')
      )
      .join('\n');
    const blob = new Blob(['\uFEFF' + csv], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `حجوزات_${reportFrom}_${reportTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function printBooking(b) {
    const dateStr = getBaghdadDateString(new Date(b.starts_at));
    const w = window.open('', '_blank');
    w.document.write(`
      <html dir="rtl"><head><meta charset="utf-8"><title>${
        b.booking_number
      }</title>
      <style>
        body{font-family:Tahoma,sans-serif;padding:32px;color:#111}
        h1{margin:0 0 4px}
        table{width:100%;border-collapse:collapse;margin-top:16px}
        td{padding:8px;border-bottom:1px solid #ddd}
        td:first-child{color:#666;width:160px}
      </style></head><body>
      <h1>ملاعب كابتن نديم</h1>
      <p>إيصال حجز</p>
      <table>
        <tr><td>رقم الحجز</td><td>${b.booking_number}</td></tr>
        <tr><td>اسم العميل</td><td>${b.customer_name}</td></tr>
        <tr><td>رقم الهاتف</td><td>${b.phone}</td></tr>
        <tr><td>الملعب</td><td>${b.courts?.name || ''}</td></tr>
        <tr><td>التاريخ</td><td>${formatArabicDateDMY(dateStr)}</td></tr>
        <tr><td>اليوم</td><td>${arabicWeekdayFromDateString(dateStr)}</td></tr>
        <tr><td>الوقت</td><td>${formatArabicTime12h(
          new Date(b.starts_at)
        )}</td></tr>
        <tr><td>المدة</td><td>${formatDurationLabel(
          b.duration_minutes
        )}</td></tr>
        <tr><td>السعر</td><td>${money(b.price_at_booking)} د.ع</td></tr>
        <tr><td>الحالة</td><td>${b.status}</td></tr>
      </table>
      <script>window.print()</script>
      </body></html>
    `);
    w.document.close();
  }

  /* =========================================================
   * الواجهة
   * ========================================================= */
  const STATUS_LABEL = {
    new: 'جديد',
    confirmed: 'مؤكد',
    completed: 'مكتمل',
    cancelled: 'ملغي',
    no_show: 'لم يحضر',
  };

  return (
    <div className="page" dir="rtl">
      <header className="hero">
        <div className="hero-inner">
          <h1 className="hero-title">
            <span className="ball">⚽</span>
            {settings?.business_name || 'ملاعب كابتن نديم'}
          </h1>
          <p className="hero-subtitle">
            اختر ملعبك، شوف الأوقات المتاحة، واحجز مباشرة.
          </p>
          <p className="live-clock">
            {arabicWeekdayFromDateString(getBaghdadDateString(now))}{' '}
            {formatArabicDateDMY(getBaghdadDateString(now))} —{' '}
            {formatArabicTime12h(now)}
          </p>
        </div>
      </header>

      <main className="content">
        {courtsLoading && (
          <p className="state-message">جارٍ تحميل الملاعب...</p>
        )}
        {courtsError && (
          <div className="state-message error">
            حدث خطأ أثناء تحميل الملاعب، حاول مرة أخرى.
          </div>
        )}
        {!courtsLoading && !courtsError && courts.length === 0 && (
          <p className="state-message">لا توجد ملاعب حالياً.</p>
        )}

        {courts.length > 0 && (
          <div className="fields-grid">
            {courts.map((c) => (
              <div key={c.id} className="field-card">
                <h2 className="field-name">{c.name}</h2>
                <p className="field-spec">
                  {c.capacity} لاعبين{c.includes_goalkeeper ? ' + حارس' : ''}
                </p>
                <div className="field-price">
                  <span className="amount">{money(c.price)}</span>
                  <span className="unit">د.ع / ساعة</span>
                </div>
                {c.is_active ? (
                  <button className="btn-book" onClick={() => openBooking(c)}>
                    حجز
                  </button>
                ) : (
                  <p className="closed-note">الملعب مغلق مؤقتاً</p>
                )}
              </div>
            ))}
          </div>
        )}

        <section className="rules">
          <h2 className="rules-title">تعليمات الملعب</h2>
          <ul className="rules-list">
            <li>ممنوع التدخين نهائياً داخل صالة الملعب.</li>
            <li>
              الالتزام بزي رياضي مناسب: حذاء صالات غير أسود النعل، وملابس
              رياضية.
            </li>
            <li>ممنوع إدخال الزجاج أو أي مشروبات زجاجية إلى أرضية الملعب.</li>
            <li>
              الالتزام بوقت الحجز والمغادرة عند انتهائه حتى لا يتأخر الفريق
              التالي.
            </li>
            <li>المحافظة على نظافة الملعب وعدم ترك النفايات داخل الصالة.</li>
            <li>الأطفال دون سن 12 سنة يجب أن يرافقهم شخص بالغ داخل الصالة.</li>
            <li>الإدارة غير مسؤولة عن أي أغراض شخصية تُفقد داخل الملعب.</li>
          </ul>
        </section>

        {/* ---------- البحث عن حجزي ---------- */}
        <section className="search-booking">
          <h2 className="rules-title">البحث عن حجزي</h2>
          <form className="search-form" onSubmit={handleSearchBooking}>
            <input
              placeholder="رقم الحجز (مثال: KN-2026-000125)"
              value={searchNumber}
              onChange={(e) => setSearchNumber(e.target.value)}
              required
            />
            <input
              placeholder="رقم الهاتف"
              value={searchPhone}
              onChange={(e) => setSearchPhone(e.target.value)}
              required
            />
            <button type="submit" disabled={searchLoading}>
              {searchLoading ? 'جارٍ البحث...' : 'بحث'}
            </button>
          </form>

          {searchError && <p className="state-message error">{searchError}</p>}

          {searchResult && (
            <div className="booking-summary">
              <p>
                <strong>رقم الحجز:</strong> {searchResult.out_booking_number}
              </p>
              <p>
                <strong>الملعب:</strong> {searchResult.out_court_name}
              </p>
              <p>
                <strong>الوقت:</strong>{' '}
                {formatArabicTime12h(new Date(searchResult.out_starts_at))}
              </p>
              <p>
                <strong>التاريخ:</strong>{' '}
                {formatArabicDateDMY(
                  getBaghdadDateString(new Date(searchResult.out_starts_at))
                )}
              </p>
              <p>
                <strong>السعر:</strong> {money(searchResult.out_price)} د.ع
              </p>
              <p>
                <strong>الحالة:</strong>{' '}
                {STATUS_LABEL[searchResult.out_status] ||
                  searchResult.out_status}
              </p>

              {['new', 'confirmed'].includes(searchResult.out_status) && (
                <button className="btn-cancel-self" onClick={handleSelfCancel}>
                  إلغاء الحجز (يسمح قبل {settings?.cancellation_hours ?? 3}{' '}
                  ساعات من الموعد)
                </button>
              )}
              {cancelMsg && (
                <p
                  className={
                    cancelMsg.ok
                      ? 'state-message success'
                      : 'state-message error'
                  }
                >
                  {cancelMsg.text}
                </p>
              )}
            </div>
          )}
        </section>
      </main>

      <footer className="footer">
        <span>
          {settings?.business_name || 'ملاعب كابتن نديم'} —{' '}
          {new Date().getFullYear()}
        </span>
        {settings?.phone && <span>للاستفسار: {settings.phone}</span>}
        <span className="admin-toggle">
          {!session && (
            <button className="link-button" onClick={() => setShowLogin(true)}>
              دخول الإدارة
            </button>
          )}
          {session && (
            <>
              {isStaffOrAdmin ? (
                <button
                  className="link-button"
                  onClick={() => setShowAdminPanel(true)}
                >
                  فتح لوحة الإدارة
                </button>
              ) : (
                'لا تملك صلاحية إدارية'
              )}{' '}
              ·{' '}
              <button className="link-button" onClick={handleLogout}>
                تسجيل خروج
              </button>
            </>
          )}
        </span>
      </footer>

      {/* =========================================================
       * Modal: تسجيل دخول الإدارة
       * ========================================================= */}
      {showLogin && (
        <div className="modal-overlay" onClick={() => setShowLogin(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h3>تسجيل دخول الإدارة</h3>
            <form onSubmit={handleLogin}>
              <input
                type="email"
                placeholder="البريد الإلكتروني"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                required
              />
              <input
                type="password"
                placeholder="كلمة المرور"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                required
              />
              {loginError && <p className="login-error">{loginError}</p>}
              <button
                type="submit"
                className="btn-login"
                disabled={loginLoading}
              >
                {loginLoading ? 'جارٍ الدخول...' : 'دخول'}
              </button>
            </form>
            <button className="modal-close" onClick={() => setShowLogin(false)}>
              إغلاق
            </button>
          </div>
        </div>
      )}

      {/* =========================================================
       * Modal: الحجز (خطوات: أوقات -> بيانات -> مراجعة -> نجاح)
       * ========================================================= */}
      {bookingCourt && (
        <div className="modal-overlay" onClick={closeBooking}>
          <div
            className="modal-box booking-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3>{bookingCourt.name}</h3>
              <button className="modal-x" onClick={closeBooking}>
                ✕
              </button>
            </div>

            {bookingStep === 'slots' && (
              <>
                <label className="field-label">اختر التاريخ</label>
                <input
                  type="date"
                  value={bookingDate}
                  min={getBaghdadDateString()}
                  onChange={(e) => {
                    const v = e.target.value;
                    // يسمح بالكتابة اليدوية أثناء التعديل حتى لو مؤقتاً غير مكتملة،
                    // لكن لا يقبل أبداً تحديث الحسابات إلا بتاريخ صحيح ومكتمل
                    if (isValidDateString(v)) setBookingDate(v);
                    else if (v === '') setBookingDate(getBaghdadDateString());
                  }}
                />
                <p className="slots-day-label">
                  {isValidDateString(bookingDate)
                    ? `${arabicWeekdayFromDateString(
                        bookingDate
                      )} — ${formatArabicDateDMY(bookingDate)}`
                    : 'اختر تاريخاً صحيحاً'}
                </p>

                {availabilityLoading && (
                  <p className="state-message">جارٍ تحميل الأوقات...</p>
                )}
                {!availabilityLoading && slots.length === 0 && (
                  <p className="state-message">
                    لا توجد أوقات متاحة لهذا اليوم.
                  </p>
                )}

                <div className="slots-grid">
                  {slots.map((s, i) => (
                    <button
                      key={i}
                      className={`slot slot-${s.status}`}
                      disabled={s.status !== 'available'}
                      onClick={() => pickSlot(s)}
                    >
                      {formatArabicTime12h(s.start)}
                      <span className="slot-status">
                        {s.status === 'available' && 'متاح'}
                        {s.status === 'booked' && 'محجوز'}
                        {s.status === 'past' && 'منتهي'}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}

            {bookingStep === 'form' && (
              <form onSubmit={goToReview}>
                <p className="slots-day-label">
                  {arabicWeekdayFromDateString(bookingDate)}{' '}
                  {formatArabicDateDMY(bookingDate)} —{' '}
                  {formatArabicTime12h(selectedSlot.start)}
                </p>
                <label className="field-label">الاسم الكامل</label>
                <input
                  value={custName}
                  onChange={(e) => setCustName(e.target.value)}
                  required
                />
                <label className="field-label">رقم الهاتف</label>
                <input
                  value={custPhone}
                  onChange={(e) => setCustPhone(e.target.value)}
                  required
                />
                <label className="field-label">
                  البريد الإلكتروني (اختياري)
                </label>
                <input
                  type="email"
                  value={custEmail}
                  onChange={(e) => setCustEmail(e.target.value)}
                />
                <label className="field-label">ملاحظات (اختياري)</label>
                <textarea
                  value={custNotes}
                  onChange={(e) => setCustNotes(e.target.value)}
                  rows={2}
                />

                {formError && (
                  <p className="state-message error">{formError}</p>
                )}

                <div className="modal-actions">
                  <button
                    type="button"
                    className="btn-cancel"
                    onClick={() => setBookingStep('slots')}
                  >
                    رجوع
                  </button>
                  <button type="submit" className="btn-save">
                    متابعة
                  </button>
                </div>
              </form>
            )}

            {bookingStep === 'review' && (
              <div>
                <h4>تفاصيل الحجز</h4>
                <table className="review-table">
                  <tbody>
                    <tr>
                      <td>الاسم</td>
                      <td>{custName}</td>
                    </tr>
                    <tr>
                      <td>الهاتف</td>
                      <td>{custPhone}</td>
                    </tr>
                    {custEmail && (
                      <tr>
                        <td>البريد</td>
                        <td>{custEmail}</td>
                      </tr>
                    )}
                    <tr>
                      <td>الملعب</td>
                      <td>{bookingCourt.name}</td>
                    </tr>
                    <tr>
                      <td>السعة</td>
                      <td>
                        {bookingCourt.capacity} لاعبين
                        {bookingCourt.includes_goalkeeper ? ' + حارس' : ''}
                      </td>
                    </tr>
                    <tr>
                      <td>اليوم</td>
                      <td>{arabicWeekdayFromDateString(bookingDate)}</td>
                    </tr>
                    <tr>
                      <td>التاريخ</td>
                      <td>{formatArabicDateDMY(bookingDate)}</td>
                    </tr>
                    <tr>
                      <td>الوقت</td>
                      <td>{formatArabicTime12h(selectedSlot.start)}</td>
                    </tr>
                    <tr>
                      <td>المدة</td>
                      <td>
                        {formatDurationLabel(availability.duration_minutes)}
                      </td>
                    </tr>
                    <tr>
                      <td>السعر</td>
                      <td>{money(bookingCourt.price)} د.ع</td>
                    </tr>
                  </tbody>
                </table>

                {submitError && (
                  <p className="state-message error">{submitError}</p>
                )}

                <div className="modal-actions">
                  <button
                    type="button"
                    className="btn-cancel"
                    onClick={() => setBookingStep('form')}
                    disabled={submitting}
                  >
                    تعديل البيانات
                  </button>
                  <button
                    type="button"
                    className="btn-save"
                    onClick={confirmBooking}
                    disabled={submitting}
                  >
                    {submitting ? 'جارٍ الحجز...' : 'تأكيد الحجز'}
                  </button>
                </div>
              </div>
            )}

            {bookingStep === 'success' && bookingResult && (
              <div>
                <p className="success-title">تم الحجز بنجاح ✅</p>
                <table className="review-table">
                  <tbody>
                    <tr>
                      <td>رقم الحجز</td>
                      <td>{bookingResult.out_booking_number}</td>
                    </tr>
                    <tr>
                      <td>الملعب</td>
                      <td>{bookingCourt.name}</td>
                    </tr>
                    <tr>
                      <td>التاريخ</td>
                      <td>
                        {arabicWeekdayFromDateString(bookingDate)}{' '}
                        {formatArabicDateDMY(bookingDate)}
                      </td>
                    </tr>
                    <tr>
                      <td>الوقت</td>
                      <td>{formatArabicTime12h(selectedSlot.start)}</td>
                    </tr>
                    <tr>
                      <td>السعر</td>
                      <td>{money(bookingResult.out_price)} د.ع</td>
                    </tr>
                  </tbody>
                </table>
                <a
                  className="btn-whatsapp"
                  href={whatsappLink()}
                  target="_blank"
                  rel="noreferrer"
                >
                  إرسال تفاصيل الحجز إلى واتساب
                </a>
                <button className="modal-close" onClick={closeBooking}>
                  إغلاق
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* =========================================================
       * لوحة الإدارة الكاملة
       * ========================================================= */}
      {showAdminPanel && isStaffOrAdmin && (
        <div className="admin-overlay">
          <div className="admin-panel">
            <div className="admin-topbar">
              <h2>لوحة تحكم {settings?.business_name}</h2>
              <div className="admin-topbar-actions">
                <button className="bell-btn" onClick={markNotificationsRead}>
                  🔔{' '}
                  {unreadCount > 0 && (
                    <span className="badge">{unreadCount}</span>
                  )}
                </button>
                <button
                  className="link-button"
                  onClick={() => setShowAdminPanel(false)}
                >
                  إغلاق اللوحة
                </button>
              </div>
            </div>

            {showNotifications && (
              <div className="notif-dropdown">
                {notifications.length === 0 && (
                  <p className="state-message">لا توجد إشعارات.</p>
                )}
                {notifications.map((n) => (
                  <div key={n.id} className="notif-item">
                    <strong>{n.title}</strong>
                    <p>{n.message}</p>
                    <span>
                      {new Date(n.created_at).toLocaleString('ar-IQ')}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="admin-tabs">
              <button
                className={adminTab === 'dashboard' ? 'active' : ''}
                onClick={() => setAdminTab('dashboard')}
              >
                لوحة المعلومات
              </button>
              <button
                className={adminTab === 'bookings' ? 'active' : ''}
                onClick={() => setAdminTab('bookings')}
              >
                الحجوزات والتقارير
              </button>
              <button
                className={adminTab === 'courts' ? 'active' : ''}
                onClick={() => setAdminTab('courts')}
              >
                الملاعب
              </button>
            </div>

            {adminTab === 'dashboard' && stats && (
              <div className="admin-section">
                <div className="stats-grid">
                  <div className="stat-card">
                    <span>{stats.todayCount}</span>حجوزات اليوم
                  </div>
                  <div className="stat-card">
                    <span>{stats.upcomingCount}</span>الحجوزات القادمة
                  </div>
                  <div className="stat-card">
                    <span>{stats.todayCompleted}</span>حجوزات اليوم المكتملة
                  </div>
                  <div className="stat-card">
                    <span>{stats.todayCancelled}</span>حجوزات اليوم الملغاة
                  </div>
                  <div className="stat-card gold">
                    <span>{money(stats.todayRevenue)}</span>إيرادات اليوم (د.ع)
                  </div>
                  <div className="stat-card gold">
                    <span>{money(stats.monthRevenue)}</span>إيرادات هذا الشهر
                    (د.ع)
                  </div>
                  <div className="stat-card">
                    <span>{stats.courtsAvailableNow}</span>الملاعب المتاحة الآن
                  </div>
                  <div className="stat-card">
                    <span>{stats.courtsBusyNow}</span>الملاعب المحجوزة الآن
                  </div>
                </div>

                <h3 className="rules-title">حجوزات اليوم</h3>
                {todayBookings.length === 0 && (
                  <p className="state-message">لا توجد حجوزات حالياً.</p>
                )}
                <div className="today-list">
                  {todayBookings.map((b) => (
                    <div key={b.id} className={`today-row status-${b.status}`}>
                      <span>{formatArabicTime12h(new Date(b.starts_at))}</span>
                      <span>{b.courts?.name}</span>
                      <span>{b.customer_name}</span>
                      <span>{STATUS_LABEL[b.status]}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {adminTab === 'bookings' && (
              <div className="admin-section">
                <div className="report-filters">
                  <label>
                    من
                    <input
                      type="date"
                      value={reportFrom}
                      onChange={(e) => setReportFrom(e.target.value)}
                    />
                  </label>
                  <label>
                    إلى
                    <input
                      type="date"
                      value={reportTo}
                      onChange={(e) => setReportTo(e.target.value)}
                    />
                  </label>
                  <label>
                    الملعب
                    <select
                      value={filterCourt}
                      onChange={(e) => setFilterCourt(e.target.value)}
                    >
                      <option value="all">الكل</option>
                      {adminCourts.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    الحالة
                    <select
                      value={filterStatus}
                      onChange={(e) => setFilterStatus(e.target.value)}
                    >
                      <option value="all">الكل</option>
                      <option value="new">جديد</option>
                      <option value="confirmed">مؤكد</option>
                      <option value="completed">مكتمل</option>
                      <option value="cancelled">ملغي</option>
                      <option value="no_show">لم يحضر</option>
                    </select>
                  </label>
                  <input
                    placeholder="بحث بالاسم / الهاتف / رقم الحجز"
                    value={searchText}
                    onChange={(e) => setSearchText(e.target.value)}
                  />
                  <button onClick={runReport}>
                    {reportLoading ? '...' : 'تحديث'}
                  </button>
                  <button onClick={exportCSV}>تصدير CSV</button>
                </div>

                <div className="stats-grid small">
                  <div className="stat-card">
                    <span>{reportSummary.count}</span>عدد الحجوزات
                  </div>
                  <div className="stat-card gold">
                    <span>{money(reportSummary.revenue)}</span>الإيرادات (د.ع)
                  </div>
                  <div className="stat-card">
                    <span>{reportSummary.completed}</span>مكتملة
                  </div>
                  <div className="stat-card">
                    <span>{reportSummary.cancelled}</span>ملغاة
                  </div>
                  <div className="stat-card">
                    <span>{reportSummary.busiestCourt}</span>أكثر ملعب حجزاً
                  </div>
                  <div className="stat-card">
                    <span>{reportSummary.busiestDay}</span>أكثر يوم ازدحاماً
                  </div>
                  <div className="stat-card">
                    <span>{reportSummary.busiestHour}</span>أكثر ساعة حجزاً
                  </div>
                </div>

                {reportRows.length === 0 && (
                  <p className="state-message">لا توجد حجوزات حالياً.</p>
                )}

                <div className="table-scroll">
                  <table className="bookings-table">
                    <thead>
                      <tr>
                        <th>رقم الحجز</th>
                        <th>العميل</th>
                        <th>الهاتف</th>
                        <th>البريد</th>
                        <th>الملعب</th>
                        <th>التاريخ</th>
                        <th>اليوم</th>
                        <th>الوقت</th>
                        <th>السعر</th>
                        <th>الحالة</th>
                        <th>إجراءات</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportRows.map((b) => {
                        const dateStr = getBaghdadDateString(
                          new Date(b.starts_at)
                        );
                        return (
                          <tr key={b.id}>
                            <td>{b.booking_number}</td>
                            <td>{b.customer_name}</td>
                            <td>{b.phone}</td>
                            <td>{b.email}</td>
                            <td>{b.courts?.name}</td>
                            <td>{formatArabicDateDMY(dateStr)}</td>
                            <td>{arabicWeekdayFromDateString(dateStr)}</td>
                            <td>
                              {formatArabicTime12h(new Date(b.starts_at))}
                            </td>
                            <td>{money(b.price_at_booking)}</td>
                            <td>
                              <select
                                value={b.status}
                                onChange={(e) =>
                                  changeStatus(b, e.target.value)
                                }
                              >
                                <option value="new">جديد</option>
                                <option value="confirmed">مؤكد</option>
                                <option value="completed">مكتمل</option>
                                <option value="cancelled">ملغي</option>
                                <option value="no_show">لم يحضر</option>
                              </select>
                            </td>
                            <td>
                              <button
                                className="link-button"
                                onClick={() => printBooking(b)}
                              >
                                طباعة
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {adminTab === 'courts' && (
              <div className="admin-section">
                {adminCourts.map((c) => (
                  <div key={c.id} className="admin-court-card">
                    <div>
                      <strong>{c.name}</strong> — {c.capacity} لاعبين
                      {c.includes_goalkeeper ? ' + حارس' : ''}
                      <div>
                        الحالة:{' '}
                        {c.is_active
                          ? 'مفتوح'
                          : `مغلق${
                              c.inactive_reason ? ' — ' + c.inactive_reason : ''
                            }`}
                      </div>
                    </div>

                    <div className="price-edit-row">
                      <input
                        type="number"
                        className="price-input"
                        placeholder={c.price}
                        value={priceDrafts[c.id] ?? ''}
                        onChange={(e) =>
                          setPriceDrafts((p) => ({
                            ...p,
                            [c.id]: e.target.value,
                          }))
                        }
                      />
                      <button
                        className="btn-save"
                        disabled={savingCourtId === c.id}
                        onClick={() => savePrice(c)}
                      >
                        {savingCourtId === c.id ? '...' : 'حفظ السعر'}
                      </button>
                    </div>

                    {c.is_active ? (
                      <div className="price-edit-row">
                        <input
                          placeholder="سبب الإغلاق (اختياري)"
                          value={closeReasonDrafts[c.id] || ''}
                          onChange={(e) =>
                            setCloseReasonDrafts((p) => ({
                              ...p,
                              [c.id]: e.target.value,
                            }))
                          }
                        />
                        <button
                          className="btn-cancel"
                          onClick={() => toggleCourtStatus(c)}
                        >
                          إغلاق الملعب
                        </button>
                      </div>
                    ) : (
                      <button
                        className="btn-save"
                        onClick={() => toggleCourtStatus(c)}
                      >
                        إعادة الفتح
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;