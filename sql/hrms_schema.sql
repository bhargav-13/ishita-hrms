-- Ishita HRMS local schema. Runs on first launch (idempotent).
-- Lives in its OWN database ("hrms"), never inside the device's "easytime" DB.
--
-- Model mirrors the Hitech payroll reference: Setup holds reusable policies
-- (Shift / Holiday / Leave / Salary components); every employee's profile
-- assigns those policies and carries its salary structure + statutory flags.

-- ---------------------------------------------------------------------------
-- Setup: reusable policies
-- ---------------------------------------------------------------------------

-- Work timings + attendance rules. weekly_offs = day numbers, 0=Sun .. 6=Sat.
CREATE TABLE IF NOT EXISTS shift (
    id               SERIAL PRIMARY KEY,
    name             VARCHAR(80) NOT NULL,
    start_time       TIME NOT NULL DEFAULT '09:00',
    end_time         TIME NOT NULL DEFAULT '18:00',
    weekly_offs      INT[] NOT NULL DEFAULT '{0}',
    grace_minutes    INT NOT NULL DEFAULT 30,
    half_day_hours   NUMERIC(4,1) NOT NULL DEFAULT 4,
    full_day_hours   NUMERIC(4,1) NOT NULL DEFAULT 8,
    overtime_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A named holiday calendar for a year.
CREATE TABLE IF NOT EXISTS holiday_policy (
    id         SERIAL PRIMARY KEY,
    name       VARCHAR(120) NOT NULL,
    year       INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS holiday (
    id        SERIAL PRIMARY KEY,
    policy_id INT NOT NULL REFERENCES holiday_policy(id) ON DELETE CASCADE,
    hdate     DATE NOT NULL,
    name      VARCHAR(120) NOT NULL,
    type      VARCHAR(10) NOT NULL DEFAULT 'PUBLIC'   -- PUBLIC / OPTIONAL
);

-- Leave policy with its types. cycle = YEARLY / MONTHLY.
CREATE TABLE IF NOT EXISTS leave_policy (
    id         SERIAL PRIMARY KEY,
    name       VARCHAR(120) NOT NULL,
    cycle      VARCHAR(10) NOT NULL DEFAULT 'YEARLY',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS leave_type (
    id           SERIAL PRIMARY KEY,
    policy_id    INT NOT NULL REFERENCES leave_policy(id) ON DELETE CASCADE,
    name         VARCHAR(80) NOT NULL,
    annual_count NUMERIC(6,2) NOT NULL DEFAULT 0,
    accrual      VARCHAR(16) NOT NULL DEFAULT 'ALL_AT_ONCE', -- ALL_AT_ONCE / MONTHLY
    paid         BOOLEAN NOT NULL DEFAULT TRUE
);

-- Org-wide default salary components (earnings + deductions) new staff inherit.
-- kind = EARNING/DEDUCTION, calc = CTC/BASIC/GROSS/FLAT.
CREATE TABLE IF NOT EXISTS salary_component (
    id         SERIAL PRIMARY KEY,
    name       VARCHAR(80) NOT NULL,
    kind       VARCHAR(10) NOT NULL,
    calc       VARCHAR(10) NOT NULL,
    value      NUMERIC(12,2) NOT NULL DEFAULT 0,
    cap        NUMERIC(12,2),
    threshold  NUMERIC(12,2),
    sort_order INT NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- Employees (maps device emp_code) + their salary structure & assigned policies
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employee (
    id            SERIAL PRIMARY KEY,
    emp_code      VARCHAR(20) UNIQUE NOT NULL,   -- = easytime.iclock_transaction.emp_code
    full_name     VARCHAR(150) NOT NULL,
    department    VARCHAR(120),
    designation   VARCHAR(120),
    category      VARCHAR(16) NOT NULL DEFAULT 'REGULAR', -- REGULAR/CONTRACTOR/WORK_BASIS
    date_of_join  DATE,
    active        BOOLEAN NOT NULL DEFAULT TRUE,

    -- salary structure
    monthly_ctc      NUMERIC(12,2) NOT NULL DEFAULT 0,
    basic            NUMERIC(12,2) NOT NULL DEFAULT 0,
    hra              NUMERIC(12,2) NOT NULL DEFAULT 0,
    other_allowances NUMERIC(12,2) NOT NULL DEFAULT 0,
    work_type        VARCHAR(10),                 -- DAILY/HOURLY/PIECE (WORK_BASIS only)
    work_rate        NUMERIC(12,2) NOT NULL DEFAULT 0,
    salary_basis     VARCHAR(10) NOT NULL DEFAULT 'SHIFT', -- SHIFT / PUNCH
    pf               BOOLEAN NOT NULL DEFAULT FALSE,
    esic             BOOLEAN NOT NULL DEFAULT FALSE,
    pt               BOOLEAN NOT NULL DEFAULT FALSE,

    -- assigned setup policies
    shift_id          INT REFERENCES shift(id),
    holiday_policy_id INT REFERENCES holiday_policy(id),
    leave_policy_id   INT REFERENCES leave_policy(id),

    -- bank / statutory
    bank_account VARCHAR(40),
    ifsc         VARCHAR(20),
    bank_name    VARCHAR(120),
    pan          VARCHAR(20),

    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Leave requests, payroll runs, payslips
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leave_request (
    id            SERIAL PRIMARY KEY,
    employee_id   INT NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
    leave_type_id INT REFERENCES leave_type(id),
    from_date     DATE NOT NULL,
    to_date       DATE NOT NULL,
    status        VARCHAR(12) NOT NULL DEFAULT 'PENDING', -- PENDING/APPROVED/REJECTED
    reason        TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A payroll cycle over any date range: WEEKLY (Thu run), MONTHLY, or CUSTOM.
CREATE TABLE IF NOT EXISTS payroll_run (
    id              SERIAL PRIMARY KEY,
    label           VARCHAR(120),
    period_type     VARCHAR(10) NOT NULL DEFAULT 'WEEKLY', -- WEEKLY/MONTHLY/CUSTOM
    from_date       DATE NOT NULL,
    to_date         DATE NOT NULL,
    apply_statutory BOOLEAN NOT NULL DEFAULT FALSE,        -- PF/ESIC/PT (usually only on monthly)
    status          VARCHAR(12) NOT NULL DEFAULT 'DRAFT',  -- DRAFT/FINALISED
    run_by          VARCHAR(120),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payslip (
    id              SERIAL PRIMARY KEY,
    payroll_run_id  INT NOT NULL REFERENCES payroll_run(id) ON DELETE CASCADE,
    employee_id     INT NOT NULL REFERENCES employee(id),
    present_days    NUMERIC(6,1) NOT NULL DEFAULT 0,
    half_days       NUMERIC(6,1) NOT NULL DEFAULT 0,
    paid_leave_days NUMERIC(6,1) NOT NULL DEFAULT 0,
    week_off_days   NUMERIC(6,1) NOT NULL DEFAULT 0,
    holiday_days    NUMERIC(6,1) NOT NULL DEFAULT 0,
    absent_days     NUMERIC(6,1) NOT NULL DEFAULT 0,
    payable_days    NUMERIC(6,1) NOT NULL DEFAULT 0,
    ot_hours        NUMERIC(8,2) NOT NULL DEFAULT 0,
    gross           NUMERIC(12,2) NOT NULL DEFAULT 0,
    pf              NUMERIC(12,2) NOT NULL DEFAULT 0,
    esic            NUMERIC(12,2) NOT NULL DEFAULT 0,
    pt              NUMERIC(12,2) NOT NULL DEFAULT 0,
    deductions      NUMERIC(12,2) NOT NULL DEFAULT 0,
    net_pay         NUMERIC(12,2) NOT NULL DEFAULT 0,
    UNIQUE (payroll_run_id, employee_id)
);

-- ---------------------------------------------------------------------------
-- Seed sensible defaults once (statutory components + a general shift)
-- ---------------------------------------------------------------------------
INSERT INTO salary_component (name, kind, calc, value, cap, threshold, sort_order)
SELECT * FROM (VALUES
    ('Basic',            'EARNING',   'CTC',   50,   NULL,  NULL,  1),
    ('HRA',              'EARNING',   'CTC',   20,   NULL,  NULL,  2),
    ('PF',               'DEDUCTION', 'BASIC', 12,   15000, NULL,  3),
    ('ESIC',             'DEDUCTION', 'GROSS', 0.75, NULL,  NULL,  4),
    ('Professional Tax', 'DEDUCTION', 'FLAT',  200,  NULL,  15000, 5)
) AS v(name, kind, calc, value, cap, threshold, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM salary_component);

INSERT INTO shift (name, start_time, end_time, weekly_offs, grace_minutes)
SELECT 'General (9 AM - 6 PM)', '09:00', '18:00', '{0}', 30
WHERE NOT EXISTS (SELECT 1 FROM shift);
