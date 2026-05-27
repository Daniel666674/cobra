-- Cobra – initial schema
-- Run: node src/db/migrate.js

CREATE TABLE IF NOT EXISTS tenants (
  id            INT PRIMARY KEY AUTO_INCREMENT,
  name          VARCHAR(120)  NOT NULL,
  slug          VARCHAR(60)   NOT NULL UNIQUE,
  wa_number     VARCHAR(20),
  bold_key      VARCHAR(200),
  alegra_user   VARCHAR(120),
  alegra_token  VARCHAR(200),
  dapta_agent   VARCHAR(80),
  plan          ENUM('starter','premier','enterprise') DEFAULT 'premier',
  active        TINYINT DEFAULT 1,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id            INT PRIMARY KEY AUTO_INCREMENT,
  tenant_id     INT NOT NULL,
  name          VARCHAR(120) NOT NULL,
  email         VARCHAR(180) NOT NULL UNIQUE,
  password_hash VARCHAR(200) NOT NULL,
  role          ENUM('admin','collector','viewer') DEFAULT 'collector',
  active        TINYINT DEFAULT 1,
  last_login    TIMESTAMP NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE TABLE IF NOT EXISTS clients (
  id              INT PRIMARY KEY AUTO_INCREMENT,
  tenant_id       INT NOT NULL,
  name            VARCHAR(120) NOT NULL,
  phone           VARCHAR(20),
  cedula          VARCHAR(20),
  email           VARCHAR(180),
  address         TEXT,
  risk_score      TINYINT DEFAULT 50,          -- 0-100 (higher = riskier)
  pref_channel    ENUM('wa','call','both') DEFAULT 'wa',
  pref_hour       TINYINT DEFAULT 10,          -- preferred contact hour
  income_day      TINYINT,                     -- day of month client gets paid
  notes           TEXT,
  opt_out         TINYINT DEFAULT 0,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  INDEX idx_tenant (tenant_id),
  INDEX idx_phone (phone)
);

CREATE TABLE IF NOT EXISTS credits (
  id            INT PRIMARY KEY AUTO_INCREMENT,
  tenant_id     INT NOT NULL,
  client_id     INT NOT NULL,
  total_amount  DECIMAL(14,2) NOT NULL,
  cuota         DECIMAL(14,2) NOT NULL,
  due_date      DATE NOT NULL,
  status        ENUM('vigente','porvencer','mora','pagado') DEFAULT 'vigente',
  stage         TINYINT DEFAULT 0,             -- escalation stage 0-4
  dias_mora     INT DEFAULT 0,                 -- updated daily by cron
  product       VARCHAR(120),
  description   TEXT,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  paid_at       TIMESTAMP NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (client_id) REFERENCES clients(id),
  INDEX idx_tenant_status (tenant_id, status),
  INDEX idx_due_date (due_date)
);

CREATE TABLE IF NOT EXISTS promises (
  id              INT PRIMARY KEY AUTO_INCREMENT,
  tenant_id       INT NOT NULL,
  credit_id       INT NOT NULL,
  client_id       INT NOT NULL,
  collector_id    INT,
  promised_date   DATE NOT NULL,
  promised_amount DECIMAL(14,2) NOT NULL,
  confidence      TINYINT DEFAULT 70,          -- 0-100
  status          ENUM('pending','kept','broken','partial') DEFAULT 'pending',
  source          ENUM('wa','call','manual') DEFAULT 'manual',
  notes           TEXT,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  resolved_at     TIMESTAMP NULL,
  FOREIGN KEY (credit_id) REFERENCES credits(id),
  INDEX idx_credit (credit_id),
  INDEX idx_date (promised_date)
);

CREATE TABLE IF NOT EXISTS comm_log (
  id            INT PRIMARY KEY AUTO_INCREMENT,
  tenant_id     INT NOT NULL,
  client_id     INT NOT NULL,
  credit_id     INT,
  channel       ENUM('wa','call','email','sms') NOT NULL,
  direction     ENUM('out','in') DEFAULT 'out',
  message       TEXT,
  status        VARCHAR(40) DEFAULT 'sent',    -- sent, delivered, read, failed
  wa_msg_id     VARCHAR(80),                   -- Meta message ID
  dapta_call_id VARCHAR(80),                   -- Dapta call reference
  sent_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_client (client_id),
  INDEX idx_sent_at (sent_at)
);

CREATE TABLE IF NOT EXISTS payments (
  id            INT PRIMARY KEY AUTO_INCREMENT,
  tenant_id     INT NOT NULL,
  credit_id     INT NOT NULL,
  client_id     INT NOT NULL,
  amount        DECIMAL(14,2) NOT NULL,
  method        ENUM('nequi','daviplata','card','pse','cash','transfer') NOT NULL,
  bold_ref      VARCHAR(80),
  alegra_inv_id VARCHAR(40),
  alegra_cufe   VARCHAR(200),                  -- DIAN electronic invoice code
  status        ENUM('pending','confirmed','failed') DEFAULT 'confirmed',
  notes         TEXT,
  paid_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (credit_id) REFERENCES credits(id),
  INDEX idx_credit (credit_id),
  INDEX idx_paid_at (paid_at)
);

CREATE TABLE IF NOT EXISTS risk_events (
  id          INT PRIMARY KEY AUTO_INCREMENT,
  client_id   INT NOT NULL,
  event_type  VARCHAR(60) NOT NULL,            -- promise_broken, ignored_wa, partial_pay, etc.
  delta       TINYINT NOT NULL,                -- +/- change to risk_score
  note        TEXT,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_client (client_id)
);
