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
