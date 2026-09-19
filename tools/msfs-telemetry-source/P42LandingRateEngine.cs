using System;
using System.Collections.Generic;
using System.Linq;

namespace SkylineVA.Msfs2024Telemetry;

// Directly adapted from the landing detector supplied in Desktop/接地检测.
// It is fed one visual-frame sample at a time and has no SimConnect dependency.
internal sealed record LandingRateSample(
    DateTimeOffset Timestamp,
    bool OnGround,
    double AltitudeAboveGroundFt,
    double TouchdownNormalVelocityFpm,
    double GForce);

internal sealed record LandingRateResult(
    DateTimeOffset Timestamp,
    double LandingRateFpm,
    double PeakGForce,
    int BounceCount,
    string Rating,
    bool Displayed);

internal sealed class P42LandingRateEngine
{
    private readonly double minimumLandingHeightFt;
    private readonly TimeSpan gForceWindow;
    private readonly List<double> gForceSamples = new();
    private bool previousOnGround = true;
    private bool minimumLandingHeightReached;
    private bool airborneAfterLanding;
    private bool landingRateDisplayed;
    private bool gForceCaptureActive;
    private bool resultEmitted;
    private DateTimeOffset landingTimestamp;
    private DateTimeOffset gForceCaptureUntil;
    private double landingRateFpm;
    private double peakGForce;
    private int bounceCount;

    public P42LandingRateEngine(double minimumLandingHeightFt = 50, TimeSpan? gForceWindow = null)
    {
        if (!double.IsFinite(minimumLandingHeightFt) || minimumLandingHeightFt < 0) throw new ArgumentOutOfRangeException(nameof(minimumLandingHeightFt));
        this.minimumLandingHeightFt = minimumLandingHeightFt;
        this.gForceWindow = gForceWindow ?? TimeSpan.FromMilliseconds(500);
        if (this.gForceWindow <= TimeSpan.Zero) throw new ArgumentOutOfRangeException(nameof(gForceWindow));
    }

    public LandingRateResult? Update(LandingRateSample sample)
    {
        Validate(sample);
        var touchdownEdge = sample.OnGround && !previousOnGround;
        if (gForceCaptureActive && !touchdownEdge && double.IsFinite(sample.GForce))
            gForceSamples.Add(Math.Round(sample.GForce, 2, MidpointRounding.AwayFromZero));

        UpdateAltitudeGates(sample);
        LandingRateResult? result = null;
        if (sample.OnGround != previousOnGround)
        {
            previousOnGround = sample.OnGround;
            if (landingRateDisplayed && !previousOnGround)
                airborneAfterLanding = true;
            if (landingRateDisplayed && previousOnGround && airborneAfterLanding)
            {
                bounceCount++;
                airborneAfterLanding = false;
                if (resultEmitted)
                    result = CurrentResult();
            }
            if (previousOnGround && minimumLandingHeightReached)
                StartLanding(sample);
        }

        if (gForceCaptureActive && sample.Timestamp >= gForceCaptureUntil)
        {
            gForceCaptureActive = false;
            peakGForce = gForceSamples.Count == 0 ? 0 : gForceSamples.Max();
            if (landingRateDisplayed && !resultEmitted)
            {
                resultEmitted = true;
                result = CurrentResult();
            }
        }
        return result;
    }

    public void Reset()
    {
        previousOnGround = true;
        minimumLandingHeightReached = false;
        airborneAfterLanding = false;
        landingRateDisplayed = false;
        gForceCaptureActive = false;
        resultEmitted = false;
        landingTimestamp = default;
        gForceCaptureUntil = default;
        landingRateFpm = 0;
        peakGForce = 0;
        bounceCount = 0;
        gForceSamples.Clear();
    }

    private void UpdateAltitudeGates(LandingRateSample sample)
    {
        if (sample.OnGround) return;
        if (minimumLandingHeightReached && landingRateDisplayed)
        {
            CleanupDisplayedLanding();
            return;
        }
        if (!minimumLandingHeightReached && sample.AltitudeAboveGroundFt > minimumLandingHeightFt)
            minimumLandingHeightReached = true;
    }

    private void StartLanding(LandingRateSample sample)
    {
        landingRateFpm = Math.Truncate(Math.Abs(sample.TouchdownNormalVelocityFpm));
        landingTimestamp = sample.Timestamp;
        minimumLandingHeightReached = false;
        gForceSamples.Clear();
        gForceCaptureActive = true;
        gForceCaptureUntil = sample.Timestamp + gForceWindow;
        peakGForce = 0;
        resultEmitted = false;
        landingRateDisplayed = landingRateFpm > 0;
    }

    private void CleanupDisplayedLanding()
    {
        landingRateDisplayed = false;
        minimumLandingHeightReached = false;
        airborneAfterLanding = false;
        gForceCaptureActive = false;
        resultEmitted = false;
        landingRateFpm = 0;
        peakGForce = 0;
        bounceCount = 0;
        gForceSamples.Clear();
    }

    private static string RateToRating(double peakG)
    {
        if (!double.IsFinite(peakG) || peakG <= 0) return "UNKNOWN";
        if (peakG < 1.5) return "SMOOTH";
        if (peakG < 2.5) return "GOOD";
        if (peakG < 3.5) return "HARD";
        return "CRASH";
    }

    private LandingRateResult CurrentResult() => new(
        landingTimestamp,
        landingRateFpm,
        peakGForce,
        bounceCount,
        RateToRating(peakGForce),
        true);

    private static void Validate(LandingRateSample sample)
    {
        if (sample.Timestamp == default) throw new ArgumentException("Timestamp 不能为空。", nameof(sample));
        if (!double.IsFinite(sample.AltitudeAboveGroundFt) || !double.IsFinite(sample.TouchdownNormalVelocityFpm))
            throw new ArgumentException("AGL 和 touchdown velocity 必须是有限数字。", nameof(sample));
    }
}

internal sealed class P42LandingDetector
{
    private readonly RunwayResolver runwayResolver;
    private readonly P42LandingRateEngine engine = new();
    private bool previousOnGround = true;
    private bool landingHeightReached;
    private TelemetrySample? touchdownSample;

    public P42LandingDetector(RunwayResolver runwayResolver) => this.runwayResolver = runwayResolver;

    public void Reset()
    {
        engine.Reset();
        previousOnGround = true;
        landingHeightReached = false;
        touchdownSample = null;
    }

    public LandingReport? Observe(TelemetrySample sample)
    {
        if (!previousOnGround && !sample.OnGround && sample.RadioAltitudeFt > 50)
            landingHeightReached = true;
        if (sample.OnGround && !previousOnGround && landingHeightReached)
        {
            touchdownSample = sample;
            landingHeightReached = false;
        }
        // Some third-party aircraft (notably Fenix Airbus) publish
        // TOUCHDOWN NORMAL VELOCITY one or more frames after the on-ground
        // edge.  The edge sample still has a reliable vertical speed, so use
        // it as a fallback or the detector would silently discard the
        // landing before the value arrives.
        var touchdownRateFpm = Math.Abs(sample.TouchdownNormalVelocityFpm);
        if (!double.IsFinite(touchdownRateFpm) || touchdownRateFpm <= 0)
            touchdownRateFpm = Math.Abs(sample.VerticalSpeedFpm);
        var result = engine.Update(new LandingRateSample(sample.Timestamp, sample.OnGround, sample.RadioAltitudeFt, touchdownRateFpm, sample.GForce));
        previousOnGround = sample.OnGround;
        if (result is null || !result.Displayed) return null;

        var contact = touchdownSample ?? sample;
        var runway = runwayResolver.Resolve(contact);
        var peakG = result.PeakGForce;
        return new LandingReport(
            result.Timestamp,
            contact.AircraftTitle,
            contact.AircraftModel,
            contact.Callsign,
            runway?.Airport ?? contact.RunwayAirport,
            runway?.Runway ?? string.Empty,
            Math.Round(result.LandingRateFpm),
            peakG,
            1.0,
            peakG - 1.0,
            contact.IndicatedAirspeedKt,
            contact.PitchDeg,
            contact.BankDeg,
            contact.Latitude,
            contact.Longitude,
            runway?.DistanceM ?? contact.RunwayDistanceM,
            runway?.LateralDistanceM ?? -1,
            runway?.HeadingDeg ?? 0,
            "P42LandingRateEngine",
            0,
            result.Rating,
            -1,
            -1,
            contact.IndicatedAirspeedKt,
            contact.RadioAltitudeFt,
            result.BounceCount,
            "p42-landing-rate-engine");
    }
}
