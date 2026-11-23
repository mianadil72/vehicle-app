-- Vehicle inventory schema for SQL Server. Safe to re-run: objects are only created when missing.
-- Run via `npm run db:setup`, which creates the database first and splits batches on GO.

IF OBJECT_ID(N'dbo.Vehicles', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.Vehicles (
    VehicleId    INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Vehicles PRIMARY KEY,
    Make         NVARCHAR(50)  NOT NULL,           -- shown as "Name" in the UI
    Model        NVARCHAR(100) NOT NULL,
    ModelYear    SMALLINT      NOT NULL CONSTRAINT CK_Vehicles_ModelYear CHECK (ModelYear BETWEEN 1900 AND 2100),
    Price        DECIMAL(10,2) NOT NULL CONSTRAINT CK_Vehicles_Price CHECK (Price >= 0),
    -- Keep in sync with CATEGORIES in src/types.ts (each category also needs a silhouette in the UI).
    Category     NVARCHAR(20)  NOT NULL CONSTRAINT CK_Vehicles_Category
                   CHECK (Category IN (N'Sedan', N'SUV', N'Truck', N'Coupe', N'Electric', N'Van')),
    Condition    NVARCHAR(20)  NOT NULL CONSTRAINT CK_Vehicles_Condition
                   CHECK (Condition IN (N'New', N'Used', N'Certified')),
    Mileage      INT           NOT NULL CONSTRAINT CK_Vehicles_Mileage CHECK (Mileage >= 0),
    Color        NVARCHAR(50)  NOT NULL,
    ColorHex     CHAR(7)       NOT NULL CONSTRAINT CK_Vehicles_ColorHex CHECK (ColorHex LIKE '#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]'),
    StockNumber  VARCHAR(20)   NOT NULL CONSTRAINT UQ_Vehicles_StockNumber UNIQUE,
    CreatedAt    DATETIME2(0)  NOT NULL CONSTRAINT DF_Vehicles_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt    DATETIME2(0)  NOT NULL CONSTRAINT DF_Vehicles_UpdatedAt DEFAULT SYSUTCDATETIME()
  );

  CREATE INDEX IX_Vehicles_Category ON dbo.Vehicles (Category) INCLUDE (Price, ModelYear);
END
GO

IF OBJECT_ID(N'dbo.VehiclePhotos', N'U') IS NULL
BEGIN
  -- Photo URLs per vehicle; SortOrder 0 is the cover image. Files live in public/vehicles/<id>/.
  CREATE TABLE dbo.VehiclePhotos (
    PhotoId    INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_VehiclePhotos PRIMARY KEY,
    VehicleId  INT           NOT NULL CONSTRAINT FK_VehiclePhotos_Vehicles
                 REFERENCES dbo.Vehicles (VehicleId) ON DELETE CASCADE,
    SortOrder  INT           NOT NULL,
    Url        NVARCHAR(400) NOT NULL,
    CONSTRAINT UQ_VehiclePhotos_Order UNIQUE (VehicleId, SortOrder)
  );
END
GO

IF OBJECT_ID(N'dbo.Users', N'U') IS NULL
BEGIN
  -- Internal user accounts. Only 'admin' may add, edit or delete vehicles; 'staff' can view only.
  -- 'manager' (lead sales manager) assigns customer leads; 'sales' (rep) follows up on their leads.
  -- Create or reset accounts with `npm run user -- <username> --role admin|manager|sales|staff`.
  CREATE TABLE dbo.Users (
    UserId        INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Users PRIMARY KEY,
    Username      NVARCHAR(50)  NOT NULL CONSTRAINT UQ_Users_Username UNIQUE,  -- stored lower-case
    PasswordHash  VARCHAR(200)  NOT NULL,                                       -- scrypt, see server/auth.ts
    Role          VARCHAR(10)   NOT NULL CONSTRAINT CK_Users_Role CHECK (Role IN ('admin', 'manager', 'sales', 'staff')),
    IsActive      BIT           NOT NULL CONSTRAINT DF_Users_IsActive DEFAULT 1,
    CreatedAt     DATETIME2(0)  NOT NULL CONSTRAINT DF_Users_CreatedAt DEFAULT SYSUTCDATETIME(),
    LastLoginAt   DATETIME2(0)  NULL
  );
END
GO

IF OBJECT_ID(N'dbo.Sessions', N'U') IS NULL
BEGIN
  -- Signed-in sessions. Only a SHA-256 hash of the cookie token is stored.
  CREATE TABLE dbo.Sessions (
    TokenHash  BINARY(32)    NOT NULL CONSTRAINT PK_Sessions PRIMARY KEY,
    UserId     INT           NOT NULL CONSTRAINT FK_Sessions_Users REFERENCES dbo.Users (UserId) ON DELETE CASCADE,
    CreatedAt  DATETIME2(0)  NOT NULL CONSTRAINT DF_Sessions_CreatedAt DEFAULT SYSUTCDATETIME(),
    ExpiresAt  DATETIME2(0)  NOT NULL
  );
  CREATE INDEX IX_Sessions_UserId ON dbo.Sessions (UserId);
  CREATE INDEX IX_Sessions_ExpiresAt ON dbo.Sessions (ExpiresAt);
END
GO

IF OBJECT_ID(N'dbo.VehicleComments', N'U') IS NULL
BEGIN
  -- Reviews/notes on a vehicle. Everyone can read them; only admins can add or delete them.
  CREATE TABLE dbo.VehicleComments (
    CommentId  INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_VehicleComments PRIMARY KEY,
    VehicleId  INT            NOT NULL CONSTRAINT FK_VehicleComments_Vehicles
                 REFERENCES dbo.Vehicles (VehicleId) ON DELETE CASCADE,
    UserId     INT            NOT NULL CONSTRAINT FK_VehicleComments_Users REFERENCES dbo.Users (UserId),
    Body       NVARCHAR(2000) NOT NULL CONSTRAINT CK_VehicleComments_Body CHECK (LEN(Body) > 0),
    CreatedAt  DATETIME2(0)   NOT NULL CONSTRAINT DF_VehicleComments_CreatedAt DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX IX_VehicleComments_VehicleId ON dbo.VehicleComments (VehicleId, CreatedAt DESC);
END
GO

IF OBJECT_ID(N'dbo.PasswordResetRequests', N'U') IS NULL
BEGIN
  -- "Forgot password" requests waiting for an admin. At most one open request per user.
  CREATE TABLE dbo.PasswordResetRequests (
    UserId       INT          NOT NULL CONSTRAINT PK_PasswordResetRequests PRIMARY KEY
                   CONSTRAINT FK_PasswordResetRequests_Users REFERENCES dbo.Users (UserId) ON DELETE CASCADE,
    RequestedAt  DATETIME2(0) NOT NULL CONSTRAINT DF_PasswordResetRequests_RequestedAt DEFAULT SYSUTCDATETIME()
  );
END
GO

IF OBJECT_ID(N'dbo.PasswordResetTokens', N'U') IS NULL
BEGIN
  -- One-time reset links created by an admin. Only a SHA-256 hash of the token is stored;
  -- creating a new link for a user replaces their previous one.
  CREATE TABLE dbo.PasswordResetTokens (
    TokenHash        BINARY(32)   NOT NULL CONSTRAINT PK_PasswordResetTokens PRIMARY KEY,
    UserId           INT          NOT NULL CONSTRAINT FK_PasswordResetTokens_Users REFERENCES dbo.Users (UserId) ON DELETE CASCADE,
    CreatedByUserId  INT          NOT NULL CONSTRAINT FK_PasswordResetTokens_CreatedBy REFERENCES dbo.Users (UserId),
    CreatedAt        DATETIME2(0) NOT NULL CONSTRAINT DF_PasswordResetTokens_CreatedAt DEFAULT SYSUTCDATETIME(),
    ExpiresAt        DATETIME2(0) NOT NULL
  );
  CREATE INDEX IX_PasswordResetTokens_UserId ON dbo.PasswordResetTokens (UserId);
END
GO

-- ---------------------------------------------------------------------------------------------
-- CRM: customer leads (server/leads.ts). Roles: 'manager' (lead sales manager) and 'sales' (rep).
-- ---------------------------------------------------------------------------------------------

-- Migration for databases created before the manager/sales roles existed.
IF EXISTS (
  SELECT 1 FROM sys.check_constraints
   WHERE name = N'CK_Users_Role' AND parent_object_id = OBJECT_ID(N'dbo.Users')
     AND definition NOT LIKE N'%manager%'
)
BEGIN
  ALTER TABLE dbo.Users DROP CONSTRAINT CK_Users_Role;
  ALTER TABLE dbo.Users ADD CONSTRAINT CK_Users_Role CHECK (Role IN ('admin', 'manager', 'sales', 'staff'));
END
GO

IF OBJECT_ID(N'dbo.Customers', N'U') IS NULL
BEGIN
  -- One row per email address, holding the details from the customer's first enquiry. Never updated:
  -- each lead keeps the details it was submitted with (dbo.Leads.FirstName...ContactConsent).
  CREATE TABLE dbo.Customers (
    CustomerId        INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Customers PRIMARY KEY,
    FirstName         NVARCHAR(50)  NOT NULL,
    LastName          NVARCHAR(50)  NOT NULL,
    Email             NVARCHAR(254) NOT NULL CONSTRAINT UQ_Customers_Email UNIQUE,  -- stored lower-case
    Mobile            VARCHAR(20)   NOT NULL,                                       -- digits, optional leading +
    PreferredContact  VARCHAR(10)   NOT NULL CONSTRAINT CK_Customers_PreferredContact CHECK (PreferredContact IN ('Email', 'Text', 'Phone')),
    ContactConsent    BIT           NOT NULL CONSTRAINT DF_Customers_ContactConsent DEFAULT 0,
    CreatedAt         DATETIME2(0)  NOT NULL CONSTRAINT DF_Customers_CreatedAt DEFAULT SYSUTCDATETIME()
  );
END
GO

IF OBJECT_ID(N'dbo.Leads', N'U') IS NULL
BEGIN
  -- A customer's enquiry. NextFollowUpDue is 2 days after the lead arrives for the 1st follow-up,
  -- then 2 days after each logged follow-up; NULL when unassigned, after the 3rd, or once closed.
  -- FirstName...ContactConsent are the contact details as submitted with this enquiry.
  CREATE TABLE dbo.Leads (
    LeadId             INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Leads PRIMARY KEY,
    CustomerId         INT            NOT NULL CONSTRAINT FK_Leads_Customers REFERENCES dbo.Customers (CustomerId) ON DELETE CASCADE,
    FirstName          NVARCHAR(50)   NOT NULL,
    LastName           NVARCHAR(50)   NOT NULL,
    Email              NVARCHAR(254)  NOT NULL,
    Mobile             VARCHAR(20)    NOT NULL,
    PreferredContact   VARCHAR(10)    NOT NULL CONSTRAINT CK_Leads_PreferredContact CHECK (PreferredContact IN ('Email', 'Text', 'Phone')),
    ContactConsent     BIT            NOT NULL CONSTRAINT DF_Leads_ContactConsent DEFAULT 0,
    VehicleId          INT            NULL CONSTRAINT FK_Leads_Vehicles REFERENCES dbo.Vehicles (VehicleId) ON DELETE SET NULL,
    InterestCondition  NVARCHAR(20)   NOT NULL CONSTRAINT CK_Leads_InterestCondition CHECK (InterestCondition IN ('New', 'Used', 'Certified')),
    UrgencyDays        INT            NOT NULL CONSTRAINT CK_Leads_UrgencyDays CHECK (UrgencyDays BETWEEN 1 AND 365),
    Message            NVARCHAR(1000) NULL,
    Source             VARCHAR(10)    NOT NULL CONSTRAINT CK_Leads_Source CHECK (Source IN ('contact', 'vehicle', 'chat')),
    Status             VARCHAR(20)    NOT NULL CONSTRAINT DF_Leads_Status DEFAULT 'New'
                         CONSTRAINT CK_Leads_Status CHECK (Status IN ('New', 'Assigned', 'FirstFollowUp', 'SecondFollowUp', 'ThirdFollowUp', 'Won', 'Lost')),
    AssignedToUserId   INT            NULL CONSTRAINT FK_Leads_AssignedTo REFERENCES dbo.Users (UserId),
    AssignedAt         DATETIME2(0)   NULL,
    NextFollowUpDue    DATETIME2(0)   NULL,
    CreatedAt          DATETIME2(0)   NOT NULL CONSTRAINT DF_Leads_CreatedAt DEFAULT SYSUTCDATETIME(),
    ClosedAt           DATETIME2(0)   NULL
  );
  CREATE INDEX IX_Leads_Status_Due ON dbo.Leads (Status, NextFollowUpDue);
  CREATE INDEX IX_Leads_AssignedTo ON dbo.Leads (AssignedToUserId);
  CREATE INDEX IX_Leads_CustomerId ON dbo.Leads (CustomerId);
END
GO

-- Migration: databases whose dbo.Leads predates the per-lead contact details. Add the columns (nullable),
-- fill existing leads from their customer, then make them NOT NULL.
IF COL_LENGTH(N'dbo.Leads', N'FirstName') IS NULL ALTER TABLE dbo.Leads ADD FirstName NVARCHAR(50) NULL;
IF COL_LENGTH(N'dbo.Leads', N'LastName') IS NULL ALTER TABLE dbo.Leads ADD LastName NVARCHAR(50) NULL;
IF COL_LENGTH(N'dbo.Leads', N'Email') IS NULL ALTER TABLE dbo.Leads ADD Email NVARCHAR(254) NULL;
IF COL_LENGTH(N'dbo.Leads', N'Mobile') IS NULL ALTER TABLE dbo.Leads ADD Mobile VARCHAR(20) NULL;
IF COL_LENGTH(N'dbo.Leads', N'PreferredContact') IS NULL ALTER TABLE dbo.Leads ADD PreferredContact VARCHAR(10) NULL;
IF COL_LENGTH(N'dbo.Leads', N'ContactConsent') IS NULL
  ALTER TABLE dbo.Leads ADD ContactConsent BIT NOT NULL CONSTRAINT DF_Leads_ContactConsent DEFAULT 0;
GO

UPDATE l
   SET FirstName = COALESCE(l.FirstName, c.FirstName), LastName = COALESCE(l.LastName, c.LastName),
       Email = COALESCE(l.Email, c.Email), Mobile = COALESCE(l.Mobile, c.Mobile),
       PreferredContact = COALESCE(l.PreferredContact, c.PreferredContact)
  FROM dbo.Leads l
  JOIN dbo.Customers c ON c.CustomerId = l.CustomerId
 WHERE l.FirstName IS NULL OR l.LastName IS NULL OR l.Email IS NULL OR l.Mobile IS NULL OR l.PreferredContact IS NULL;
GO

IF COLUMNPROPERTY(OBJECT_ID(N'dbo.Leads'), N'FirstName', 'AllowsNull') = 1
BEGIN
  ALTER TABLE dbo.Leads ALTER COLUMN FirstName NVARCHAR(50) NOT NULL;
  ALTER TABLE dbo.Leads ALTER COLUMN LastName NVARCHAR(50) NOT NULL;
  ALTER TABLE dbo.Leads ALTER COLUMN Email NVARCHAR(254) NOT NULL;
  ALTER TABLE dbo.Leads ALTER COLUMN Mobile VARCHAR(20) NOT NULL;
  ALTER TABLE dbo.Leads ALTER COLUMN PreferredContact VARCHAR(10) NOT NULL;
END
IF OBJECT_ID(N'dbo.CK_Leads_PreferredContact', N'C') IS NULL
  ALTER TABLE dbo.Leads ADD CONSTRAINT CK_Leads_PreferredContact CHECK (PreferredContact IN ('Email', 'Text', 'Phone'));
GO

IF OBJECT_ID(N'dbo.LeadFollowUps', N'U') IS NULL
BEGIN
  -- The 1st, 2nd and 3rd follow-up logged by a sales rep.
  CREATE TABLE dbo.LeadFollowUps (
    FollowUpId  INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_LeadFollowUps PRIMARY KEY,
    LeadId      INT            NOT NULL CONSTRAINT FK_LeadFollowUps_Leads REFERENCES dbo.Leads (LeadId) ON DELETE CASCADE,
    Number      TINYINT        NOT NULL CONSTRAINT CK_LeadFollowUps_Number CHECK (Number BETWEEN 1 AND 3),
    UserId      INT            NOT NULL CONSTRAINT FK_LeadFollowUps_Users REFERENCES dbo.Users (UserId),
    Method      VARCHAR(10)    NOT NULL CONSTRAINT CK_LeadFollowUps_Method CHECK (Method IN ('Email', 'Text', 'Phone')),
    Note        NVARCHAR(1000) NOT NULL,
    CreatedAt   DATETIME2(0)   NOT NULL CONSTRAINT DF_LeadFollowUps_CreatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_LeadFollowUps_LeadNumber UNIQUE (LeadId, Number)
  );
END
GO

IF OBJECT_ID(N'dbo.LeadNotifications', N'U') IS NULL
BEGIN
  -- Email/text messages about a lead (outbox + audit). 'Logged' = SMTP isn't configured, so the
  -- message was only written to the server console.
  CREATE TABLE dbo.LeadNotifications (
    NotificationId  INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_LeadNotifications PRIMARY KEY,
    LeadId          INT            NOT NULL CONSTRAINT FK_LeadNotifications_Leads REFERENCES dbo.Leads (LeadId) ON DELETE CASCADE,
    Channel         VARCHAR(5)     NOT NULL CONSTRAINT CK_LeadNotifications_Channel CHECK (Channel IN ('email', 'sms')),
    Recipient       NVARCHAR(254)  NOT NULL,
    Subject         NVARCHAR(200)  NOT NULL,
    Body            NVARCHAR(4000) NOT NULL,
    Status          VARCHAR(10)    NOT NULL CONSTRAINT DF_LeadNotifications_Status DEFAULT 'Pending'
                      CONSTRAINT CK_LeadNotifications_Status CHECK (Status IN ('Pending', 'Sent', 'Failed', 'Logged')),
    Error           NVARCHAR(500)  NULL,
    CreatedAt       DATETIME2(0)   NOT NULL CONSTRAINT DF_LeadNotifications_CreatedAt DEFAULT SYSUTCDATETIME(),
    SentAt          DATETIME2(0)   NULL
  );
  CREATE INDEX IX_LeadNotifications_LeadId ON dbo.LeadNotifications (LeadId);
END
GO

-- ---------------------------------------------------------------------------------------------
-- Accounting: sales, perks, manager overrides, salaries, bi-weekly pay (server/sales.ts, payroll.ts).
-- dbo.EarningEntries is an append-only ledger: rows are never updated or deleted; corrections are new rows.
-- ---------------------------------------------------------------------------------------------

-- A sales rep's manager (gets the override on the rep's sales; approves them; sees their pay).
IF COL_LENGTH(N'dbo.Users', N'ManagerUserId') IS NULL
  ALTER TABLE dbo.Users ADD ManagerUserId INT NULL CONSTRAINT FK_Users_Manager REFERENCES dbo.Users (UserId);
GO

-- Available: listed for sale. SalePending: a sale is waiting for approval. Sold: approved sale.
IF COL_LENGTH(N'dbo.Vehicles', N'SaleStatus') IS NULL
BEGIN
  ALTER TABLE dbo.Vehicles ADD SaleStatus VARCHAR(12) NOT NULL CONSTRAINT DF_Vehicles_SaleStatus DEFAULT 'Available'
    CONSTRAINT CK_Vehicles_SaleStatus CHECK (SaleStatus IN ('Available', 'SalePending', 'Sold'));
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Vehicles_SaleStatus' AND object_id = OBJECT_ID(N'dbo.Vehicles'))
  CREATE INDEX IX_Vehicles_SaleStatus ON dbo.Vehicles (SaleStatus);
GO

IF OBJECT_ID(N'dbo.CompPlans', N'U') IS NULL
BEGIN
  -- Commission plan versions. The plan in effect on the approval date is used, and stored on the sale.
  CREATE TABLE dbo.CompPlans (
    PlanId           INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_CompPlans PRIMARY KEY,
    EffectiveFrom    DATE          NOT NULL CONSTRAINT UQ_CompPlans_EffectiveFrom UNIQUE,
    ManagerOverride  DECIMAL(12,2) NOT NULL CONSTRAINT CK_CompPlans_Override CHECK (ManagerOverride >= 0),
    CreatedByUserId  INT           NULL CONSTRAINT FK_CompPlans_CreatedBy REFERENCES dbo.Users (UserId),
    CreatedAt        DATETIME2(0)  NOT NULL CONSTRAINT DF_CompPlans_CreatedAt DEFAULT SYSUTCDATETIME()
  );
END
GO

IF OBJECT_ID(N'dbo.CompPlanTiers', N'U') IS NULL
BEGIN
  -- Per-vehicle perk by the rep's unit number in the calendar month (marginal): FromUnit 1, 9, 13 ...
  CREATE TABLE dbo.CompPlanTiers (
    PlanId      INT           NOT NULL CONSTRAINT FK_CompPlanTiers_Plans REFERENCES dbo.CompPlans (PlanId) ON DELETE CASCADE,
    FromUnit    INT           NOT NULL CONSTRAINT CK_CompPlanTiers_FromUnit CHECK (FromUnit >= 1),
    PerVehicle  DECIMAL(12,2) NOT NULL CONSTRAINT CK_CompPlanTiers_PerVehicle CHECK (PerVehicle >= 0),
    CONSTRAINT PK_CompPlanTiers PRIMARY KEY (PlanId, FromUnit)
  );
END
GO

IF OBJECT_ID(N'dbo.EmployeeSalaries', N'U') IS NULL
BEGIN
  -- Annual base salary history; a pay period uses the salary in effect on its first day (annual / 26).
  CREATE TABLE dbo.EmployeeSalaries (
    UserId           INT           NOT NULL CONSTRAINT FK_EmployeeSalaries_Users REFERENCES dbo.Users (UserId),
    EffectiveFrom    DATE          NOT NULL,
    AnnualSalary     DECIMAL(12,2) NOT NULL CONSTRAINT CK_EmployeeSalaries_Amount CHECK (AnnualSalary >= 0),
    CreatedByUserId  INT           NULL CONSTRAINT FK_EmployeeSalaries_CreatedBy REFERENCES dbo.Users (UserId),
    CreatedAt        DATETIME2(0)  NOT NULL CONSTRAINT DF_EmployeeSalaries_CreatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_EmployeeSalaries PRIMARY KEY (UserId, EffectiveFrom)
  );
END
GO

IF OBJECT_ID(N'dbo.Sales', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.Sales (
    SaleId            INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Sales PRIMARY KEY,
    VehicleId         INT            NOT NULL CONSTRAINT FK_Sales_Vehicles REFERENCES dbo.Vehicles (VehicleId),
    LeadId            INT            NULL CONSTRAINT FK_Sales_Leads REFERENCES dbo.Leads (LeadId) ON DELETE SET NULL,
    BuyerName         NVARCHAR(100)  NOT NULL,
    ListPrice         DECIMAL(12,2)  NOT NULL,
    SalePrice         DECIMAL(12,2)  NOT NULL CONSTRAINT CK_Sales_SalePrice CHECK (SalePrice > 0),
    SaleDate          DATE           NOT NULL,
    SoldByUserId      INT            NOT NULL CONSTRAINT FK_Sales_SoldBy REFERENCES dbo.Users (UserId),
    -- The seller's manager at approval time: earns the override (NULL when a manager/admin sold it).
    ManagerUserId     INT            NULL CONSTRAINT FK_Sales_Manager REFERENCES dbo.Users (UserId),
    Status            VARCHAR(10)    NOT NULL CONSTRAINT DF_Sales_Status DEFAULT 'Pending'
                        CONSTRAINT CK_Sales_Status CHECK (Status IN ('Pending', 'Approved', 'Rejected', 'Voided')),
    -- The seller's nth approved sale in the sale's calendar month (fixed at approval) and the plan used.
    MonthUnit         INT            NULL,
    PlanId            INT            NULL CONSTRAINT FK_Sales_Plans REFERENCES dbo.CompPlans (PlanId),
    Notes             NVARCHAR(1000) NULL,
    SubmittedAt       DATETIME2(0)   NOT NULL CONSTRAINT DF_Sales_SubmittedAt DEFAULT SYSUTCDATETIME(),
    DecidedByUserId   INT            NULL CONSTRAINT FK_Sales_DecidedBy REFERENCES dbo.Users (UserId),
    DecidedAt         DATETIME2(0)   NULL,
    RejectReason      NVARCHAR(300)  NULL,
    VoidedByUserId    INT            NULL CONSTRAINT FK_Sales_VoidedBy REFERENCES dbo.Users (UserId),
    VoidedAt          DATETIME2(0)   NULL,
    VoidReason        NVARCHAR(300)  NULL
  );
  -- At most one live (pending or approved) sale per vehicle.
  CREATE UNIQUE INDEX UX_Sales_LiveVehicle ON dbo.Sales (VehicleId) WHERE Status IN ('Pending', 'Approved');
  CREATE INDEX IX_Sales_SoldBy_Date ON dbo.Sales (SoldByUserId, SaleDate);
  CREATE INDEX IX_Sales_Status ON dbo.Sales (Status);
END
GO

IF OBJECT_ID(N'dbo.PayPeriods', N'U') IS NULL
BEGIN
  -- Bi-weekly (Mon-Sun x 2) pay periods, created on demand. Closed periods accept no new entries.
  CREATE TABLE dbo.PayPeriods (
    PeriodStart     DATE         NOT NULL CONSTRAINT PK_PayPeriods PRIMARY KEY,
    PeriodEnd       DATE         NOT NULL,
    Status          VARCHAR(6)   NOT NULL CONSTRAINT DF_PayPeriods_Status DEFAULT 'Open'
                      CONSTRAINT CK_PayPeriods_Status CHECK (Status IN ('Open', 'Closed')),
    ClosedByUserId  INT          NULL CONSTRAINT FK_PayPeriods_ClosedBy REFERENCES dbo.Users (UserId),
    ClosedAt        DATETIME2(0) NULL
  );
END
GO

IF OBJECT_ID(N'dbo.EarningEntries', N'U') IS NULL
BEGIN
  -- Append-only earnings ledger. A pay statement is the sum of a person's entries in a period.
  CREATE TABLE dbo.EarningEntries (
    EntryId          INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_EarningEntries PRIMARY KEY,
    UserId           INT           NOT NULL CONSTRAINT FK_EarningEntries_Users REFERENCES dbo.Users (UserId),
    PeriodStart      DATE          NOT NULL CONSTRAINT FK_EarningEntries_Periods REFERENCES dbo.PayPeriods (PeriodStart),
    Type             VARCHAR(16)   NOT NULL CONSTRAINT CK_EarningEntries_Type
                       CHECK (Type IN ('Salary', 'Perk', 'Override', 'PerkReversal', 'OverrideReversal', 'Adjustment')),
    Amount           DECIMAL(12,2) NOT NULL,
    SaleId           INT           NULL CONSTRAINT FK_EarningEntries_Sales REFERENCES dbo.Sales (SaleId),
    Note             NVARCHAR(300) NULL,
    CreatedByUserId  INT           NULL CONSTRAINT FK_EarningEntries_CreatedBy REFERENCES dbo.Users (UserId),
    CreatedAt        DATETIME2(0)  NOT NULL CONSTRAINT DF_EarningEntries_CreatedAt DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX IX_EarningEntries_Period_User ON dbo.EarningEntries (PeriodStart, UserId);
  CREATE INDEX IX_EarningEntries_Sale ON dbo.EarningEntries (SaleId);
END
GO

-- Default commission plan (v1): perks $200 / $300 / $400 from the 1st / 9th / 13th unit of the month,
-- manager override $50 per team vehicle. Admins add new versions in the app.
IF NOT EXISTS (SELECT 1 FROM dbo.CompPlans)
BEGIN
  DECLARE @plan INT;
  INSERT INTO dbo.CompPlans (EffectiveFrom, ManagerOverride) VALUES ('2026-11-02', 50.00);
  SET @plan = SCOPE_IDENTITY();
  INSERT INTO dbo.CompPlanTiers (PlanId, FromUnit, PerVehicle) VALUES (@plan, 1, 200.00), (@plan, 9, 300.00), (@plan, 13, 400.00);
END
GO
