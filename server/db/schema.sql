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
  -- Create or reset accounts with `npm run user -- <username> --role admin|staff`.
  CREATE TABLE dbo.Users (
    UserId        INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Users PRIMARY KEY,
    Username      NVARCHAR(50)  NOT NULL CONSTRAINT UQ_Users_Username UNIQUE,  -- stored lower-case
    PasswordHash  VARCHAR(200)  NOT NULL,                                       -- scrypt, see server/auth.ts
    Role          VARCHAR(10)   NOT NULL CONSTRAINT CK_Users_Role CHECK (Role IN ('admin', 'staff')),
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
