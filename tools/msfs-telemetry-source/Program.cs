using System.Text.Json;
using System.Threading.Channels;
using System.Runtime.InteropServices;
using SimConnect.NET;

namespace SkylineVA.Msfs2024Telemetry;

internal sealed record TelemetrySample(
    DateTimeOffset Timestamp,
    string AircraftTitle,
    string AircraftModel,
    string Callsign,
    double Latitude,
    double Longitude,
    double HeadingDeg,
    double AltitudeFt,
    double RadioAltitudeFt,
    double GroundClearanceFt,
    double GroundSpeedKt,
    double IndicatedAirspeedKt,
    double VerticalSpeedFpm,
    double BodyVerticalSpeedFps,
    double WorldVerticalSpeedFps,
    double TouchdownNormalVelocityFpm,
    bool OnGround,
    bool EngineRunning,
    double GForce,
    double PitchDeg,
    double BankDeg,
    double FuelKg,
    double FuelCapacityKg,
    double SimulationRate,
    bool SlewActive,
    string RunwayAirport,
    double RunwayDistanceM,
    double RunwayHeadingDeg,
    double RunwayEndDistanceM)
{
    // MSFS cockpit heading displays normally use magnetic heading. Keep the
    // true heading above for geospatial calculations and expose both values.
    public double? MagneticHeadingDeg { get; init; }
    public double? TrueAirspeedKt { get; init; }
    public string AircraftTypeCode { get; init; } = string.Empty;
    public string LoadedAircraftName { get; init; } = string.Empty;
    public bool? LandingLights { get; init; }
    public bool? TaxiLights { get; init; }
    public bool? BeaconLights { get; init; }
    public bool? AntiCollisionLights { get; init; }
    public bool? NavigationLights { get; init; }
    public bool? StrobeLights { get; init; }
    public bool? ParkingBrake { get; init; }
    public double? FlapsPercent { get; init; }
    public double? SpoilersPercent { get; init; }
    public double? GearPercent { get; init; }
}

internal sealed record LandingReport(
    DateTimeOffset Timestamp,
    string AircraftTitle,
    string AircraftModel,
    string Callsign,
    string Airport,
    string Runway,
    double LandingRateFpm,
    double PeakG,
    double BaselineG,
    double DeltaG,
    double TouchdownSpeedKt,
    double TouchdownPitchDeg,
    double TouchdownBankDeg,
    double TouchdownLatitude,
    double TouchdownLongitude,
    double RunwayDistanceM,
    double LateralDistanceM,
    double RunwayHeadingDeg,
    string RateSource,
    double RadioAltitudeRateFpm,
    string RateConfidence,
    double ApproachSpeed1000FtKt,
    double ApproachSpeed500FtKt,
    double ThresholdSpeedKt,
    double ThresholdHeightFt,
    int BounceCount,
    string Detector);

internal sealed record FuelCommand(string Id, double TargetPercent);
internal sealed record FuelCommandStatus(string Id, string State, string Message, double TargetPercent, int AppliedTanks, DateTimeOffset UpdatedAt);

internal readonly record struct NativeAircraftIdentity(string Title, string AtcModel, string AtcType, string AtcId, string LoadedAircraftName);

// SimConnect.NET reliably streams numeric SimVars, while MSFS string identity
// fields require native STRING256 definitions on a separate persistent request.
internal sealed class NativeAircraftIdentityReader : IAsyncDisposable
{
    private const uint TitleDefinition = 101, AtcModelDefinition = 102, AtcTypeDefinition = 103, AtcIdDefinition = 104;
    private const uint TitleRequest = 101, AtcModelRequest = 102, AtcTypeRequest = 103, AtcIdRequest = 104;
    private const uint AircraftLoadedRequest = 105, AircraftLoadedEvent = 105;
    private const uint UserAircraft = 0, PeriodSecond = 4, String256 = 9, Unused = 0xFFFFFFFF;
    private const uint RecvQuit = 3, RecvEvent = 4, RecvEventFilename = 6, RecvSimObjectData = 8, RecvSystemState = 15;
    private readonly object sync = new();
    private readonly DispatchCallback dispatchCallback;
    private EventWaitHandle? signal;
    private CancellationTokenSource? dispatchCancellation;
    private Task? dispatchTask;
    private IntPtr handle;
    private NativeAircraftIdentity identity;

    public NativeAircraftIdentityReader() => dispatchCallback = DispatchCallbackEntry;

    public NativeAircraftIdentity Snapshot
    {
        get { lock (sync) return identity; }
    }

    public Task ConnectAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (handle != IntPtr.Zero) return Task.CompletedTask;
        var nativeSignal = new EventWaitHandle(false, EventResetMode.AutoReset);
        Check(SimConnectOpen(out var newHandle, "Flight Career Manager Aircraft Identity", IntPtr.Zero, 0,
            nativeSignal.SafeWaitHandle.DangerousGetHandle(), 0), "SimConnect_Open identity");
        try
        {
            Add(newHandle, TitleDefinition, "TITLE");
            Add(newHandle, AtcModelDefinition, "ATC MODEL");
            Add(newHandle, AtcTypeDefinition, "ATC TYPE");
            Add(newHandle, AtcIdDefinition, "ATC ID");
            Check(RequestData(newHandle, TitleRequest, TitleDefinition), "request TITLE");
            Check(RequestData(newHandle, AtcModelRequest, AtcModelDefinition), "request ATC MODEL");
            Check(RequestData(newHandle, AtcTypeRequest, AtcTypeDefinition), "request ATC TYPE");
            Check(RequestData(newHandle, AtcIdRequest, AtcIdDefinition), "request ATC ID");
            Check(SubscribeSystemEvent(newHandle, AircraftLoadedEvent, "AircraftLoaded"), "subscribe AircraftLoaded");
            Check(RequestSystemState(newHandle, AircraftLoadedRequest, "AircraftLoaded"), "request AircraftLoaded");
        }
        catch
        {
            SimConnectClose(newHandle);
            nativeSignal.Dispose();
            throw;
        }
        signal = nativeSignal;
        handle = newHandle;
        dispatchCancellation = new CancellationTokenSource();
        dispatchTask = Task.Run(() => DispatchLoop(newHandle, nativeSignal, dispatchCancellation.Token));
        return Task.CompletedTask;
    }

    private void DispatchLoop(IntPtr nativeHandle, EventWaitHandle nativeSignal, CancellationToken token)
    {
        while (!token.IsCancellationRequested)
        {
            CallDispatch(nativeHandle, dispatchCallback, IntPtr.Zero);
            nativeSignal.WaitOne(TimeSpan.FromMilliseconds(50));
        }
    }

    private void ProcessMessage(IntPtr message)
    {
        var header = Marshal.PtrToStructure<RecvHeader>(message);
        if (header.Id == RecvQuit) return;
        if (header.Id == RecvEvent)
        {
            var eventData = Marshal.PtrToStructure<RecvEventData>(message);
            if (eventData.EventId == AircraftLoadedEvent && handle != IntPtr.Zero)
                RequestSystemState(handle, AircraftLoadedRequest, "AircraftLoaded");
            return;
        }
        if (header.Id == RecvEventFilename)
        {
            var eventData = Marshal.PtrToStructure<RecvEventFilenameData>(message);
            if (eventData.EventId == AircraftLoadedEvent) UpdateLoadedAircraft(eventData.FileName);
            return;
        }
        if (header.Id == RecvSystemState)
        {
            var stateData = Marshal.PtrToStructure<RecvSystemStateData>(message);
            if (stateData.RequestId == AircraftLoadedRequest) UpdateLoadedAircraft(stateData.Value);
            return;
        }
        if (header.Id != RecvSimObjectData) return;
        var data = Marshal.PtrToStructure<RecvSimObjectDataHeader>(message);
        var payload = IntPtr.Add(message, Marshal.OffsetOf<RecvSimObjectDataHeader>(nameof(RecvSimObjectDataHeader.Data)).ToInt32());
        var value = Clean(Marshal.PtrToStructure<NativeString256Data>(payload).Value);
        lock (sync)
        {
            identity = data.RequestId switch
            {
                TitleRequest => identity with { Title = value },
                AtcModelRequest => identity with { AtcModel = value },
                AtcTypeRequest => identity with { AtcType = value },
                AtcIdRequest => identity with { AtcId = value },
                _ => identity
            };
        }
    }

    private void UpdateLoadedAircraft(string? path)
    {
        var segments = (path ?? string.Empty).Trim().Trim('"')
            .Split(['\\', '/'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var name = string.Empty;
        for (var index = 0; index + 2 < segments.Length; index++)
        {
            if (segments[index].Equals("SimObjects", StringComparison.OrdinalIgnoreCase)
                && segments[index + 1].Equals("Airplanes", StringComparison.OrdinalIgnoreCase))
            {
                name = segments[index + 2];
                break;
            }
        }
        if (string.IsNullOrWhiteSpace(name)) return;
        lock (sync) identity = identity with { LoadedAircraftName = name };
    }

    private void DispatchCallbackEntry(IntPtr data, uint size, IntPtr context)
    {
        try
        {
            if (data != IntPtr.Zero && size >= 12) ProcessMessage(data);
        }
        catch
        {
            // Never allow malformed optional identity data to terminate the
            // persistent telemetry connection across the native callback.
        }
    }

    public async ValueTask DisposeAsync()
    {
        dispatchCancellation?.Cancel();
        signal?.Set();
        if (dispatchTask is not null) { try { await dispatchTask.WaitAsync(TimeSpan.FromSeconds(2)); } catch { } }
        if (handle != IntPtr.Zero) { try { SimConnectClose(handle); } catch { } }
        dispatchCancellation?.Dispose();
        signal?.Dispose();
        dispatchCancellation = null;
        dispatchTask = null;
        signal = null;
        handle = IntPtr.Zero;
        lock (sync) identity = default;
    }

    private static string Clean(string? value) => value?.Trim('\0', ' ', '\t', '\r', '\n') ?? string.Empty;
    private static void Add(IntPtr connection, uint definition, string name) => Check(AddToDefinition(connection, definition, name, null, String256, 0, Unused), $"register {name}");
    private static int RequestData(IntPtr connection, uint request, uint definition) => RequestDataOnObject(connection, request, definition, UserAircraft, PeriodSecond, 0, 0, 0, 0);
    private static void Check(int result, string operation) { if (result < 0) throw new InvalidOperationException($"{operation} failed, HRESULT=0x{result:X8}"); }

    [StructLayout(LayoutKind.Sequential, Pack = 1)] private struct RecvHeader { public uint Size, Version, Id; }
    [StructLayout(LayoutKind.Sequential, Pack = 1)] private struct RecvEventData { public uint Size, Version, Id, GroupId, EventId, Data; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi, Pack = 1)] private struct RecvEventFilenameData
    {
        public uint Size, Version, Id, GroupId, EventId, Data;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string FileName;
        public uint Flags;
    }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi, Pack = 1)] private struct RecvSystemStateData
    {
        public uint Size, Version, Id, RequestId, Integer;
        public float Float;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string Value;
    }
    [StructLayout(LayoutKind.Sequential, Pack = 1)] private struct RecvSimObjectDataHeader
    {
        public uint Size, Version, Id, RequestId, ObjectId, DefineId, Flags, EntryNumber, OutOf, DefineCount, Data;
    }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi, Pack = 1)] private struct NativeString256Data
    {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string Value;
    }
    [UnmanagedFunctionPointer(CallingConvention.Winapi)] private delegate void DispatchCallback(IntPtr data, uint dataSize, IntPtr context);
    [DllImport("SimConnect.dll", EntryPoint = "SimConnect_Open", CharSet = CharSet.Ansi)] private static extern int SimConnectOpen(out IntPtr connection, string name, IntPtr window, uint userEvent, IntPtr eventHandle, uint configIndex);
    [DllImport("SimConnect.dll", EntryPoint = "SimConnect_Close")] private static extern int SimConnectClose(IntPtr connection);
    [DllImport("SimConnect.dll", EntryPoint = "SimConnect_AddToDataDefinition", CharSet = CharSet.Ansi)] private static extern int AddToDefinition(IntPtr connection, uint defineId, string datumName, string? unitsName, uint dataType, float epsilon, uint datumId);
    [DllImport("SimConnect.dll", EntryPoint = "SimConnect_RequestDataOnSimObject")] private static extern int RequestDataOnObject(IntPtr connection, uint requestId, uint defineId, uint objectId, uint period, uint flags, uint origin, uint interval, uint limit);
    [DllImport("SimConnect.dll", EntryPoint = "SimConnect_SubscribeToSystemEvent", CharSet = CharSet.Ansi)] private static extern int SubscribeSystemEvent(IntPtr connection, uint eventId, string eventName);
    [DllImport("SimConnect.dll", EntryPoint = "SimConnect_RequestSystemState", CharSet = CharSet.Ansi)] private static extern int RequestSystemState(IntPtr connection, uint requestId, string stateName);
    [DllImport("SimConnect.dll", EntryPoint = "SimConnect_CallDispatch")] private static extern int CallDispatch(IntPtr connection, DispatchCallback callback, IntPtr context);
}

internal sealed class SimConnectReader : IAsyncDisposable
{
    private SimConnectClient? client;
    private NativeAircraftIdentityReader? identityReader;
    private readonly List<IDisposable> subscriptions = new();
    private readonly object stateLock = new();
    private RawState state = new();
    private readonly Channel<RawState> snapshots = Channel.CreateBounded<RawState>(new BoundedChannelOptions(8)
    {
        FullMode = BoundedChannelFullMode.DropOldest,
        SingleReader = true,
        SingleWriter = true
    });

    private sealed class RawState
    {
        public string Title = "", AtcModel = "", AtcId = "", DepartureAirport = "", DestinationAirport = "";
        public double Latitude, Longitude, Altitude, RadioAltitude, GroundClearance, Heading, GroundSpeed, IndicatedAirspeed, TrueAirspeed;
        public double? MagneticHeading;
        public double VerticalSpeed, BodyVerticalSpeed, WorldVerticalSpeed, TouchdownNormalVelocity, GForce, Pitch, Bank;
        public double FuelPounds, FuelCapacityGallons, FuelWeightPerGallonPounds, SimulationRate;
        public bool OnGround, EngineRunning, SlewActive;
        public bool? LandingLights, TaxiLights, BeaconLights, NavigationLights, StrobeLights;
        public bool? ParkingBrakePosition, ParkingBrakeIndicator, PmdgParkingBrakeLever;
        public double? FlapsPercent, SpoilersPercent, GearPercent;
        public bool? GearHandleDown;
    }

    public async Task ConnectAsync(CancellationToken cancellationToken)
    {
        client = new SimConnectClient("SkylineVA MSFS 2024 Telemetry");
        await client.ConnectAsync(IntPtr.Zero, 0, 0, cancellationToken);
        identityReader = new NativeAircraftIdentityReader();
        await identityReader.ConnectAsync(cancellationToken);
        client.SimVars.RequestTimeout = TimeSpan.FromSeconds(2);
        SubscribeString("GPS FLIGHT PLAN DEPARTURE AIRPORT", value => state.DepartureAirport = Clean(value), cancellationToken);
        SubscribeString("GPS FLIGHT PLAN DESTINATION AIRPORT", value => state.DestinationAirport = Clean(value), cancellationToken);
        SubscribeNumber("PLANE LATITUDE", "degrees", value => { state.Latitude = value; Publish(); }, cancellationToken);
        SubscribeNumber("PLANE LONGITUDE", "degrees", value => state.Longitude = value, cancellationToken);
        SubscribeNumber("PLANE ALTITUDE", "feet", value => state.Altitude = value, cancellationToken);
        SubscribeNumber("PLANE ALT ABOVE GROUND", "feet", value => state.RadioAltitude = value, cancellationToken);
        SubscribeNumber("PLANE ALT ABOVE GROUND MINUS CG", "feet", value => state.GroundClearance = value, cancellationToken);
        SubscribeNumber("PLANE HEADING DEGREES TRUE", "degrees", value => state.Heading = value, cancellationToken);
        SubscribeNumber("PLANE HEADING DEGREES MAGNETIC", "degrees", value => state.MagneticHeading = value, cancellationToken);
        SubscribeNumber("GROUND VELOCITY", "knots", value => state.GroundSpeed = value, cancellationToken);
        SubscribeNumber("AIRSPEED INDICATED", "knots", value => state.IndicatedAirspeed = value, cancellationToken);
        SubscribeNumber("AIRSPEED TRUE", "knots", value => state.TrueAirspeed = value, cancellationToken);
        SubscribeNumber("VERTICAL SPEED", "feet per minute", value => state.VerticalSpeed = value, cancellationToken);
        SubscribeNumber("VELOCITY BODY Y", "feet per second", value => state.BodyVerticalSpeed = value, cancellationToken);
        SubscribeNumber("VELOCITY WORLD Y", "feet per second", value => state.WorldVerticalSpeed = value, cancellationToken);
        SubscribeNumber("PLANE TOUCHDOWN NORMAL VELOCITY", "feet per minute", value => state.TouchdownNormalVelocity = value, cancellationToken);
        SubscribeNumber("SIM ON GROUND", "bool", value => state.OnGround = value > .5, cancellationToken);
        SubscribeNumber("GENERAL ENG COMBUSTION:1", "bool", value => state.EngineRunning = value > .5, cancellationToken);
        SubscribeNumber("G FORCE", "gforce", value => state.GForce = value, cancellationToken);
        SubscribeNumber("PLANE PITCH DEGREES", "degrees", value => state.Pitch = value, cancellationToken);
        SubscribeNumber("PLANE BANK DEGREES", "degrees", value => state.Bank = value, cancellationToken);
        SubscribeNumber("FUEL TOTAL QUANTITY WEIGHT", "pounds", value => state.FuelPounds = value, cancellationToken);
        SubscribeNumber("FUEL TOTAL CAPACITY", "gallons", value => state.FuelCapacityGallons = value, cancellationToken);
        SubscribeNumber("FUEL WEIGHT PER GALLON", "pounds", value => state.FuelWeightPerGallonPounds = value, cancellationToken);
        SubscribeNumber("SIMULATION RATE", "number", value => state.SimulationRate = value, cancellationToken);
        SubscribeNumber("IS SLEW ACTIVE", "bool", value => state.SlewActive = value > .5, cancellationToken);
        SubscribeOptionalNumber("LIGHT LANDING", "bool", value => state.LandingLights = value > .5, cancellationToken);
        SubscribeOptionalNumber("LIGHT TAXI", "bool", value => state.TaxiLights = value > .5, cancellationToken);
        SubscribeOptionalNumber("LIGHT BEACON", "bool", value => state.BeaconLights = value > .5, cancellationToken);
        SubscribeOptionalNumber("LIGHT NAV", "bool", value => state.NavigationLights = value > .5, cancellationToken);
        SubscribeOptionalNumber("LIGHT STROBE", "bool", value => state.StrobeLights = value > .5, cancellationToken);
        SubscribeOptionalNumber("BRAKE PARKING POSITION", "percent", value => state.ParkingBrakePosition = value > .5, cancellationToken);
        SubscribeOptionalNumber("BRAKE PARKING INDICATOR", "bool", value => state.ParkingBrakeIndicator = value > .5, cancellationToken);
        // PMDG 737 drives its animated parking-brake lever through this local variable
        // and may leave the standard position SimVar at zero even while the lever is set.
        SubscribeOptionalNumber("L:switch_693_73X", "number", value => state.PmdgParkingBrakeLever = value > .5, cancellationToken);
        SubscribeOptionalNumber("FLAPS HANDLE PERCENT", "percent", value => state.FlapsPercent = NormalizePercent(value), cancellationToken);
        SubscribeOptionalNumber("SPOILERS HANDLE POSITION", "percent", value => state.SpoilersPercent = NormalizePercent(value), cancellationToken);
        SubscribeOptionalNumber("GEAR TOTAL PCT EXTENDED", "percent", value => state.GearPercent = NormalizePercent(value), cancellationToken);
        SubscribeOptionalNumber("GEAR HANDLE POSITION", "bool", value => state.GearHandleDown = value > .5, cancellationToken);
    }

    public async Task<TelemetrySample> ReadAsync(CancellationToken cancellationToken)
    {
        if (client is null) throw new InvalidOperationException("SimConnect 未连接");

        var raw = await snapshots.Reader.ReadAsync(cancellationToken);
        // SIM ON GROUND is the simulator's contact-state signal. Radio altitude
        // can lag or be unavailable for custom aircraft at the contact frame.
        var onGround = raw.OnGround;
        var airport = string.IsNullOrWhiteSpace(raw.DestinationAirport) ? raw.DepartureAirport : raw.DestinationAirport;
        var identity = identityReader?.Snapshot ?? default;
        var title = FirstNonEmpty(identity.Title, identity.LoadedAircraftName, raw.Title);
        var model = FirstNonEmpty(identity.AtcModel, identity.AtcType, raw.AtcModel);

        return new TelemetrySample(
            DateTimeOffset.UtcNow,
            Clean(title), Clean(model), Clean(FirstNonEmpty(identity.AtcId, raw.AtcId)),
            raw.Latitude, raw.Longitude, raw.Heading, raw.Altitude, Math.Max(0, raw.RadioAltitude),
            Math.Max(0, raw.GroundClearance),
            raw.GroundSpeed, raw.IndicatedAirspeed, raw.VerticalSpeed, raw.BodyVerticalSpeed,
            raw.WorldVerticalSpeed, raw.TouchdownNormalVelocity,
            onGround, raw.EngineRunning, raw.GForce, raw.Pitch, raw.Bank, raw.FuelPounds * 0.45359237,
            raw.FuelCapacityGallons * raw.FuelWeightPerGallonPounds * 0.45359237,
            raw.SimulationRate, raw.SlewActive, airport, -1, 0, -1)
        {
            AircraftTypeCode = Clean(FirstNonEmpty(identity.AtcType, identity.AtcModel)),
            MagneticHeadingDeg = raw.MagneticHeading,
            TrueAirspeedKt = raw.TrueAirspeed,
            LoadedAircraftName = Clean(identity.LoadedAircraftName),
            LandingLights = raw.LandingLights,
            TaxiLights = raw.TaxiLights,
            BeaconLights = raw.BeaconLights,
            AntiCollisionLights = raw.BeaconLights,
            NavigationLights = raw.NavigationLights,
            StrobeLights = raw.StrobeLights,
            ParkingBrake = MergeParkingBrake(raw.ParkingBrakePosition, raw.ParkingBrakeIndicator, raw.PmdgParkingBrakeLever),
            FlapsPercent = raw.FlapsPercent,
            SpoilersPercent = raw.SpoilersPercent,
            GearPercent = raw.GearPercent ?? (raw.GearHandleDown is null ? null : raw.GearHandleDown == true ? 100 : 0)
        };
    }

    internal static double NormalizePercent(double value) => Math.Clamp(value, 0, 100);

    internal static bool? MergeParkingBrake(params bool?[] values)
    {
        if (values.Any(value => value == true)) return true;
        if (values.Any(value => value == false)) return false;
        return null;
    }

    private void SubscribeNumber(string name, string unit, Action<double> update, CancellationToken token)
    {
        subscriptions.Add(client!.SimVars.Subscribe<double>(name, unit, SimConnectPeriod.VisualFrame,
            value => { lock (stateLock) update(value); }, 0, token));
    }

    private void SubscribeOptionalNumber(string name, string unit, Action<double> update, CancellationToken token)
    {
        try { SubscribeNumber(name, unit, update, token); }
        catch (Exception ex) { Console.WriteLine($"可选遥测字段不可用 {name}: {ex.Message}"); }
    }

    private void SubscribeString(string name, Action<string?> update, CancellationToken token)
    {
        subscriptions.Add(client!.SimVars.Subscribe<string>(name, "string", SimConnectPeriod.Second,
            value => { lock (stateLock) update(value); }, 0, token));
    }

    public async Task<int> SetFuelPercentAsync(double targetPercent, CancellationToken cancellationToken)
    {
        if (client is null) throw new InvalidOperationException("SimConnect 未连接");
        var ratio = Math.Clamp(targetPercent, 0, 100) / 100.0;
        var tankNames = new[]
        {
            "CENTER", "CENTER2", "CENTER3", "LEFT MAIN", "LEFT AUX", "LEFT TIP",
            "RIGHT MAIN", "RIGHT AUX", "RIGHT TIP", "EXTERNAL1", "EXTERNAL2"
        };
        var applied = 0;
        foreach (var tank in tankNames)
        {
            try
            {
                var capacity = await client.SimVars.GetAsync<double>($"FUEL TANK {tank} CAPACITY", "gallons", cancellationToken: cancellationToken);
                if (!double.IsFinite(capacity) || capacity <= 0.01) continue;
                await client.SimVars.SetAsync($"FUEL TANK {tank} QUANTITY", "gallons", capacity * ratio, cancellationToken: cancellationToken);
                applied += 1;
            }
            catch
            {
                // Aircraft only expose tanks that exist in their fuel system.
            }
        }
        if (applied == 0) throw new InvalidOperationException("当前飞机没有可写入的标准 MSFS 油箱");
        return applied;
    }

    private void Publish()
    {
        RawState copy;
        lock (stateLock)
        {
            copy = new RawState
            {
                Title = state.Title, AtcModel = state.AtcModel, AtcId = state.AtcId,
                DepartureAirport = state.DepartureAirport, DestinationAirport = state.DestinationAirport,
                Latitude = state.Latitude, Longitude = state.Longitude, Altitude = state.Altitude,
                RadioAltitude = state.RadioAltitude, GroundClearance = state.GroundClearance,
                Heading = state.Heading, MagneticHeading = state.MagneticHeading, GroundSpeed = state.GroundSpeed,
                IndicatedAirspeed = state.IndicatedAirspeed, TrueAirspeed = state.TrueAirspeed,
                VerticalSpeed = state.VerticalSpeed,
                BodyVerticalSpeed = state.BodyVerticalSpeed, WorldVerticalSpeed = state.WorldVerticalSpeed,
                TouchdownNormalVelocity = state.TouchdownNormalVelocity, OnGround = state.OnGround,
                EngineRunning = state.EngineRunning,
                GForce = state.GForce, Pitch = state.Pitch, Bank = state.Bank,
                FuelPounds = state.FuelPounds, FuelCapacityGallons = state.FuelCapacityGallons,
                FuelWeightPerGallonPounds = state.FuelWeightPerGallonPounds,
                SimulationRate = state.SimulationRate, SlewActive = state.SlewActive,
                LandingLights = state.LandingLights, TaxiLights = state.TaxiLights,
                BeaconLights = state.BeaconLights, NavigationLights = state.NavigationLights,
                StrobeLights = state.StrobeLights,
                ParkingBrakePosition = state.ParkingBrakePosition,
                ParkingBrakeIndicator = state.ParkingBrakeIndicator,
                PmdgParkingBrakeLever = state.PmdgParkingBrakeLever,
                FlapsPercent = state.FlapsPercent,
                SpoilersPercent = state.SpoilersPercent,
                GearPercent = state.GearPercent,
                GearHandleDown = state.GearHandleDown
            };
        }
        snapshots.Writer.TryWrite(copy);
    }

    private static string Clean(string? value) => value?.Trim('\0', ' ', '\t', '\r', '\n') ?? string.Empty;
    private static string FirstNonEmpty(params string?[] values)
    {
        foreach (var value in values) if (!string.IsNullOrWhiteSpace(value)) return value.Trim();
        return string.Empty;
    }

    public async ValueTask DisposeAsync()
    {
        foreach (var item in subscriptions)
        {
            try { item.Dispose(); } catch { }
        }
        subscriptions.Clear();
        if (identityReader is not null)
        {
            try { await identityReader.DisposeAsync(); } catch { }
        }
        identityReader = null;
        var currentClient = client;
        client = null;
        if (currentClient is null) return;
        try { await currentClient.DisconnectAsync(); } catch { }
        try { await currentClient.DisposeAsync(); } catch { }
    }
}

internal sealed record RunwayPosition(string Airport, string Runway, double DistanceM, double LateralDistanceM, double HeadingDeg);

internal sealed class RunwayResolver
{
    private readonly JsonDocument? catalog;

    public RunwayResolver(string path)
    {
        try { if (File.Exists(path)) catalog = JsonDocument.Parse(File.ReadAllBytes(path)); }
        catch { catalog = null; }
    }

    public RunwayPosition? Resolve(TelemetrySample sample)
    {
        if (catalog is null || !double.IsFinite(sample.Latitude) || !double.IsFinite(sample.Longitude)) return null;
        var airports = catalog.RootElement.GetProperty("airports");
        JsonElement airport = default;
        var nearest = double.MaxValue;
        foreach (var item in airports.EnumerateArray())
        {
            var lat = Number(item, "lat"); var lon = Number(item, "lon");
            var distance = FlatDistance(sample.Latitude, sample.Longitude, lat, lon);
            if (distance < nearest) { nearest = distance; airport = item; }
        }
        if (nearest > 12000 || !airport.TryGetProperty("ident", out var identValue)) return null;
        var ident = identValue.GetString() ?? string.Empty;
        if (!catalog.RootElement.GetProperty("runways").TryGetProperty(ident, out var runways)) return null;

        RunwayPosition? best = null;
        foreach (var runway in runways.EnumerateArray())
        {
            var length = Number(runway, "lengthFt") * 0.3048;
            if (length < 100) continue;
            AddEnd(runway, "le", length, sample, ident, ref best);
            AddEnd(runway, "he", length, sample, ident, ref best);
        }
        return best;
    }

    private static void AddEnd(JsonElement runway, string prefix, double length, TelemetrySample sample, string airport, ref RunwayPosition? best)
    {
        if (!runway.TryGetProperty(prefix + "Lat", out var latValue) || !runway.TryGetProperty(prefix + "Lon", out var lonValue)
            || latValue.ValueKind != JsonValueKind.Number || lonValue.ValueKind != JsonValueKind.Number) return;
        var lat = latValue.GetDouble(); var lon = lonValue.GetDouble();
        var heading = Number(runway, prefix + "HeadingDeg");
        if (heading <= 0)
        {
            var opposite = prefix == "le" ? "he" : "le";
            heading = Number(runway, opposite + "HeadingDeg") + 180;
            if (heading <= 0) return;
            heading %= 360;
        }
        var (east, north) = LocalMeters(lat, lon, sample.Latitude, sample.Longitude);
        var radians = heading * Math.PI / 180;
        var along = east * Math.Sin(radians) + north * Math.Cos(radians);
        var lateral = east * Math.Cos(radians) - north * Math.Sin(radians);
        if (along < -150 || along > length + 150 || Math.Abs(lateral) > 250) return;
        var candidate = new RunwayPosition(airport, runway.GetProperty(prefix + "Ident").GetString() ?? string.Empty,
            Math.Max(0, along), Math.Abs(lateral), heading);
        if (best is null || candidate.LateralDistanceM < best.LateralDistanceM
            || candidate.LateralDistanceM <= best.LateralDistanceM + 2 && candidate.DistanceM < best.DistanceM)
            best = candidate;
    }

    private static double Number(JsonElement item, string name) => item.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Number ? value.GetDouble() : 0;
    private static double FlatDistance(double lat1, double lon1, double lat2, double lon2)
    {
        var (east, north) = LocalMeters(lat1, lon1, lat2, lon2);
        return Math.Sqrt(east * east + north * north);
    }
    private static (double East, double North) LocalMeters(double lat0, double lon0, double lat, double lon)
    {
        var scale = Math.Cos(lat0 * Math.PI / 180);
        return ((lon - lon0) * 111320 * scale, (lat - lat0) * 110540);
    }
}

internal sealed class LandingDetector
{
    private const double ArmHeightFt = 50;
    private const double BounceHeightFt = 1;
    private static readonly TimeSpan PeakGWindow = TimeSpan.FromMilliseconds(500);
    private readonly List<TelemetrySample> approach = new();
    private TelemetrySample? touchdown;
    private readonly List<TelemetrySample> groundWindow = new();
    private readonly List<double> approachG = new();
    private readonly RunwayResolver runwayResolver;
    private double approachSpeed1000Ft = -1;
    private double approachSpeed500Ft = -1;
    private double thresholdSpeed = -1;
    private double thresholdHeight = -1;
    private bool captured1000;
    private bool captured500;
    private bool capturedThreshold;
    private bool observedState;
    private bool previousOnGround;
    private bool armed;
    private bool bounceArmed;
    private int bounceCount;
    private double touchdownLandingRateFpm;

    public LandingDetector(RunwayResolver runwayResolver) => this.runwayResolver = runwayResolver;

    public void Reset()
    {
        approach.Clear();
        touchdown = null;
        groundWindow.Clear();
        approachG.Clear();
        approachSpeed1000Ft = -1;
        approachSpeed500Ft = -1;
        thresholdSpeed = -1;
        thresholdHeight = -1;
        captured1000 = false;
        captured500 = false;
        capturedThreshold = false;
        observedState = false;
        previousOnGround = false;
        armed = false;
        bounceArmed = false;
        bounceCount = 0;
        touchdownLandingRateFpm = 0;
    }

    public LandingReport? Observe(TelemetrySample sample)
    {
        if (!observedState)
        {
            observedState = true;
            previousOnGround = sample.OnGround;
        }

        if (touchdown is null)
        {
            if (!sample.OnGround)
            {
                if (sample.GroundClearanceFt > ArmHeightFt)
                    armed = true;
                if (armed)
                    CaptureApproach(sample);
            }

            if (sample.OnGround && !previousOnGround && armed)
                StartTouchdown(sample);

            previousOnGround = sample.OnGround;
            return null;
        }

        if (!sample.OnGround && sample.GroundClearanceFt > BounceHeightFt)
            bounceArmed = true;
        else if (sample.OnGround && !previousOnGround && bounceArmed)
        {
            bounceCount += 1;
            bounceArmed = false;
        }

        if (sample.Timestamp - touchdown.Timestamp <= PeakGWindow)
        {
            groundWindow.Add(sample);
            if (touchdownLandingRateFpm <= 0 && Math.Abs(sample.TouchdownNormalVelocityFpm) > 0)
                touchdownLandingRateFpm = Math.Abs(sample.TouchdownNormalVelocityFpm);
        }

        previousOnGround = sample.OnGround;
        if (sample.Timestamp - touchdown.Timestamp < PeakGWindow)
            return null;

        var contact = touchdown;
        var radioRate = approach.Count >= 2
            ? Math.Abs((approach[^1].RadioAltitudeFt - approach[^2].RadioAltitudeFt)
                / Math.Max(0.05, (approach[^1].Timestamp - approach[^2].Timestamp).TotalMinutes))
            : 0;
        var rate = touchdownLandingRateFpm;
        var validG = groundWindow.Select(x => x.GForce)
            .Where(x => double.IsFinite(x) && x is > 0.2 and < 3.5).ToArray();
        var baseline = approachG.Count > 0 ? Median(approachG) : 1.0;
        var peakG = validG.Length == 0 ? baseline : validG.Max();
        var runway = runwayResolver.Resolve(contact);
        var report = new LandingReport(
            contact.Timestamp,
            contact.AircraftTitle,
            contact.AircraftModel,
            contact.Callsign,
            runway?.Airport ?? contact.RunwayAirport,
            runway?.Runway ?? string.Empty,
            Math.Round(rate),
            peakG,
            baseline,
            peakG - baseline,
            contact.IndicatedAirspeedKt,
            contact.PitchDeg,
            contact.BankDeg,
            contact.Latitude,
            contact.Longitude,
            runway?.DistanceM ?? contact.RunwayDistanceM,
            runway?.LateralDistanceM ?? -1,
            runway?.HeadingDeg ?? 0,
            "PLANE TOUCHDOWN NORMAL VELOCITY",
            Math.Round(radioRate),
            rate > 0 ? "高" : "低",
            approachSpeed1000Ft,
            approachSpeed500Ft,
            thresholdSpeed > 0 ? thresholdSpeed : contact.IndicatedAirspeedKt,
            thresholdHeight > 0 ? thresholdHeight : contact.RadioAltitudeFt,
            bounceCount,
            "flow-pro-compatible");
        Reset();
        return report;
    }

    private void CaptureApproach(TelemetrySample sample)
    {
        approach.Add(sample);
        CaptureApproachSpeeds(sample);
        if (double.IsFinite(sample.GForce) && sample.GForce is > 0.2 and < 3.5)
            approachG.Add(sample.GForce);
        while (approach.Count > 40) approach.RemoveAt(0);
        while (approachG.Count > 40) approachG.RemoveAt(0);
    }

    private void StartTouchdown(TelemetrySample sample)
    {
        touchdown = sample;
        touchdownLandingRateFpm = Math.Abs(sample.TouchdownNormalVelocityFpm);
        groundWindow.Clear();
        groundWindow.Add(sample);
        bounceArmed = false;
        bounceCount = 0;
    }

    private void CaptureApproachSpeeds(TelemetrySample sample)
    {
        if (!captured1000 && sample.RadioAltitudeFt <= 1000)
        {
            approachSpeed1000Ft = sample.IndicatedAirspeedKt;
            captured1000 = true;
        }
        if (!captured500 && sample.RadioAltitudeFt <= 500)
        {
            approachSpeed500Ft = sample.IndicatedAirspeedKt;
            captured500 = true;
        }
        if (!capturedThreshold && sample.RadioAltitudeFt <= 50)
        {
            thresholdSpeed = sample.IndicatedAirspeedKt;
            thresholdHeight = sample.RadioAltitudeFt;
            capturedThreshold = true;
        }
    }

    private static double Median(IEnumerable<double> values)
    {
        var ordered = values.OrderBy(x => x).ToArray();
        if (ordered.Length == 0) return 1;
        var middle = ordered.Length / 2;
        return ordered.Length % 2 == 0 ? (ordered[middle - 1] + ordered[middle]) / 2 : ordered[middle];
    }
}

internal static class Program
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web) { WriteIndented = false };

    public static async Task Main(string[] args)
    {
        using var singleInstance = new Semaphore(1, 1, "Local\\FlightCareerManager.MsfsTelemetry.V2");
        var ownsSingleInstance = singleInstance.WaitOne(TimeSpan.FromSeconds(5));
        if (!ownsSingleInstance) return;
        var root = ArgumentValue(args, "--data-dir");
        if (string.IsNullOrWhiteSpace(root))
            root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SkylineVA", "msfs2024-telemetry-v2");
        root = Path.GetFullPath(root);
        Directory.CreateDirectory(root);
        var telemetryPath = Path.Combine(root, "telemetry.ndjson");
        var reportPath = Path.Combine(root, "landing-reports.jsonl");
        var fuelCommandPath = Path.Combine(root, "fuel-command.json");
        var fuelStatusPath = Path.Combine(root, "fuel-status.json");
        var stopPath = ArgumentValue(args, "--stop-file");
        if (string.IsNullOrWhiteSpace(stopPath)) stopPath = Path.Combine(root, "telemetry-stop.signal");
        stopPath = Path.GetFullPath(stopPath);
        Console.WriteLine("Skyline VA MSFS 2024 独立遥测插件");
        Console.WriteLine($"数据目录: {root}");
        Console.WriteLine("等待 Microsoft Flight Simulator 2024 的 SimConnect 连接，按 Ctrl+C 退出。");

        using var stop = new CancellationTokenSource();
        Console.CancelKeyPress += (_, e) => { e.Cancel = true; stop.Cancel(); };
        var stopMonitor = MonitorStopFileAsync(stopPath, stop);
        var runwayCatalogPath = Path.Combine(AppContext.BaseDirectory, "data", "airport-catalog.json");
        var detector = new P42LandingDetector(new RunwayResolver(runwayCatalogPath));
        var lastTelemetryWriteAt = DateTimeOffset.MinValue;

        while (!stop.IsCancellationRequested)
        {
            var reader = new SimConnectReader();
            try
            {
                await reader.ConnectAsync(stop.Token);
                Console.WriteLine("SimConnect 已连接，开始实时采样。");
                while (!stop.IsCancellationRequested)
                {
                    var sample = await reader.ReadAsync(stop.Token);
                    var report = detector.Observe(sample);
                    if (report is not null)
                    {
                        await AppendAsync(reportPath, report, stop.Token);
                        Console.WriteLine($"已记录着陆: {report.AircraftModel} {report.LandingRateFpm:0} fpm, {report.PeakG:0.00} G");
                    }
                    if (sample.Timestamp - lastTelemetryWriteAt >= TimeSpan.FromMilliseconds(200))
                    {
                        await AppendAsync(telemetryPath, sample, stop.Token);
                        await ApplyPendingFuelCommandAsync(fuelCommandPath, fuelStatusPath, reader, sample, stop.Token);
                        lastTelemetryWriteAt = sample.Timestamp;
                    }
                }
            }
            catch (OperationCanceledException) when (stop.IsCancellationRequested) { }
            catch (Exception ex)
            {
                detector.Reset();
                Console.WriteLine($"等待/读取 SimConnect: {ex.Message}");
                try { await Task.Delay(2000, stop.Token); } catch (OperationCanceledException) { }
            }
            finally
            {
                try { await reader.DisposeAsync(); }
                catch (Exception ex) { Console.WriteLine($"关闭 SimConnect 会话: {ex.Message}"); }
            }
        }
        stop.Cancel();
        try { await stopMonitor; } catch (OperationCanceledException) { }
        try { File.Delete(stopPath); } catch { }
        singleInstance.Release();
    }

    private static string? ArgumentValue(string[] args, string name)
    {
        for (var index = 0; index + 1 < args.Length; index += 1)
            if (args[index].Equals(name, StringComparison.OrdinalIgnoreCase)) return args[index + 1];
        return null;
    }

    private static async Task MonitorStopFileAsync(string path, CancellationTokenSource stop)
    {
        while (!stop.IsCancellationRequested)
        {
            if (File.Exists(path))
            {
                stop.Cancel();
                return;
            }
            await Task.Delay(100, stop.Token);
        }
    }

    private static async Task AppendAsync<T>(string path, T value, CancellationToken token)
    {
        await File.AppendAllTextAsync(path, JsonSerializer.Serialize(value, JsonOptions) + Environment.NewLine, token);
    }

    private static async Task ApplyPendingFuelCommandAsync(string commandPath, string statusPath, SimConnectReader reader, TelemetrySample sample, CancellationToken token)
    {
        if (!File.Exists(commandPath)) return;
        FuelCommand? command;
        try
        {
            command = JsonSerializer.Deserialize<FuelCommand>(await File.ReadAllTextAsync(commandPath, token), JsonOptions);
            if (command is null || string.IsNullOrWhiteSpace(command.Id)) return;
            File.Delete(commandPath);
        }
        catch
        {
            return;
        }

        FuelCommandStatus result;
        if (!sample.OnGround)
        {
            result = new(command.Id, "error", "飞机必须停在地面才能加注燃油", command.TargetPercent, 0, DateTimeOffset.UtcNow);
        }
        else if (sample.EngineRunning)
        {
            result = new(command.Id, "error", "请先关闭发动机再加注燃油", command.TargetPercent, 0, DateTimeOffset.UtcNow);
        }
        else
        {
            try
            {
                var tanks = await reader.SetFuelPercentAsync(command.TargetPercent, token);
                result = new(command.Id, "applied", $"已向 {tanks} 个油箱加注至 {command.TargetPercent:0}%", command.TargetPercent, tanks, DateTimeOffset.UtcNow);
            }
            catch (Exception ex)
            {
                result = new(command.Id, "error", ex.Message, command.TargetPercent, 0, DateTimeOffset.UtcNow);
            }
        }
        await File.WriteAllTextAsync(statusPath, JsonSerializer.Serialize(result, JsonOptions), token);
    }
}
