-- Sample inventory (formerly src/data/vehicles.ts). Only inserts when the table is empty,
-- with fixed IDs so existing /vehicles/:id links keep working.

IF NOT EXISTS (SELECT 1 FROM dbo.Vehicles)
BEGIN
  SET IDENTITY_INSERT dbo.Vehicles ON;

  INSERT INTO dbo.Vehicles (VehicleId, Make, Model, ModelYear, Price, Category, Condition, Mileage, Color, ColorHex, StockNumber)
  VALUES
    (1,  N'Toyota',    N'Camry XSE',              2024, 31995, N'Sedan',    N'New',       12,    N'Celestial Silver', '#b8bcc2', 'T24-1031'),
    (2,  N'Honda',     N'Accord EX',              2022, 25450, N'Sedan',    N'Used',      28410, N'Platinum White',   '#e9e9e4', 'H22-0877'),
    (3,  N'BMW',       N'330i',                   2023, 39800, N'Sedan',    N'Certified', 14220, N'Black Sapphire',   '#1d2330', 'B23-0412'),
    (4,  N'Ford',      N'Explorer XLT',           2024, 41250, N'SUV',      N'New',       8,     N'Carbonized Gray',  '#4a4d52', 'F24-2210'),
    (5,  N'Jeep',      N'Grand Cherokee Limited', 2021, 33900, N'SUV',      N'Used',      41870, N'Diamond Black',    '#15171b', 'J21-0655'),
    (6,  N'Toyota',    N'RAV4 Hybrid',            2023, 34600, N'SUV',      N'Certified', 16750, N'Blueprint',        '#2f4f86', 'T23-0990'),
    (7,  N'Ford',      N'F-150 Lariat',           2024, 58900, N'Truck',    N'New',       15,    N'Rapid Red',        '#a3141c', 'F24-3001'),
    (8,  N'Chevrolet', N'Silverado 1500 LT',      2022, 42300, N'Truck',    N'Used',      33190, N'Summit White',     '#f2f2ef', 'C22-1477'),
    (9,  N'Ram',       N'1500 Big Horn',          2023, 44750, N'Truck',    N'Certified', 19840, N'Granite Crystal',  '#5a5e63', 'R23-0321'),
    (10, N'Ford',      N'Mustang GT',             2024, 46200, N'Coupe',    N'New',       5,     N'Grabber Blue',     '#1f78d1', 'F24-4108'),
    (11, N'Chevrolet', N'Camaro 2SS',             2021, 37950, N'Coupe',    N'Used',      22600, N'Shadow Gray',      '#55585c', 'C21-0219'),
    (12, N'Tesla',     N'Model 3 Long Range',     2023, 38990, N'Electric', N'Used',      18300, N'Pearl White',      '#f4f3ef', 'E23-0101'),
    (13, N'Hyundai',   N'Ioniq 5 SEL',            2024, 46500, N'Electric', N'New',       10,    N'Gravity Gold',     '#8c7d55', 'E24-0233'),
    (14, N'Ford',      N'Mustang Mach-E Premium', 2023, 43200, N'Electric', N'Certified', 11950, N'Star White',       '#ecebe6', 'E23-0188'),
    (15, N'Honda',     N'Odyssey EX-L',           2023, 39700, N'Van',      N'Certified', 21040, N'Obsidian Blue',    '#1e2a44', 'H23-0560'),
    (16, N'Chrysler',  N'Pacifica Touring L',     2022, 31800, N'Van',      N'Used',      36720, N'Velvet Red',       '#6e1420', 'C22-0744');

  SET IDENTITY_INSERT dbo.Vehicles OFF;
END
GO
