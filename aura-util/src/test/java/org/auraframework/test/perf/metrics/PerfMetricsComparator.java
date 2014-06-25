/*
 * Copyright (C) 2013 salesforce.com, inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *         http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
package org.auraframework.test.perf.metrics;

import java.util.Map;
import java.util.Set;
import java.util.logging.Logger;

import org.auraframework.test.perf.rdp.TimelineEventUtil;

import com.google.common.collect.ImmutableMap;
import com.google.common.collect.Maps;

/**
 * Compares actual and expected PerfMetrics values
 */
public class PerfMetricsComparator {

    // TODO: remove this once the chromedriver that supports profiling is released
    private static final boolean IGNORE_PROFILE_JSCPU_IF_ZERO = true;

    public static final PerfMetricsComparator DEFAULT_INSTANCE = new PerfMetricsComparator();

    /**
     * Override to change default behavior
     * 
     * @return null if the metric should not be exclude, else a String value explaining the reason for the exclusion
     */
    protected String getExcludedMetricMessage(String metricName) {
        return METRICS_TO_EXCLUDE.get(metricName);
    }

    /**
     * Override to change default behavior
     * 
     * @return true if metrics with that unit should be excluded
     */
    protected boolean isUnitExcluded(String unit) {
        return false;
    }

    /**
     * Override to change default behavior
     * 
     * @return the allowed percentage variability for the metric
     */
    protected int getAllowedVariability(String metricName) {
        if (metricName.startsWith("Timeline.")) {
            return 20;
        } else if (metricName.startsWith("Aura.")) {
            return 5;
        } else if (metricName.startsWith("Network.")) {
            return 20;
        } else if (metricName.startsWith("Profile.JSCPU.time")) {
            return 50;
        } else if (metricName.startsWith("Profile.JSCPU.")) {
            return 25;
        }
        return 0;
    }

    // IMPLEMENTATION:

    // NOTE: test framework classes seem to use java.util.logging
    // and using this logger the log messages do appear in the jenkins console output
    protected static final Logger LOG = Logger.getLogger(PerfMetricsComparator.class.getSimpleName());

    private static final Map<String, String> METRICS_TO_EXCLUDE; // value is reason for exclusion

    static {
        Map<String, String> map = Maps.newHashMap();

        // add loading events as those are summarized in the Network. metrics
        for (String metric : TimelineEventUtil.getCategoryMetricNames(TimelineEventUtil.Category.Loading)) {
            map.put(metric, "summarized in Network metrics");
        }
        map.put("Timeline.Loading.ParseHTML", "different when running ui vs mvn");

        map.put("Timeline.Scripting.GCEvent", "fluctuates");
        map.put("Timeline.Other.Program", "fluctuates");
        map.put("Timeline.Scripting.FunctionCall", "fluctuates");
        map.put("Timeline.Scripting.XHRReadyStateChange", "fluctuates");
        map.put("Timeline.Scripting.TimerFire", "fluctuates");
        map.put("Timeline.Scripting.TimerRemove", "fluctuates");

        map.put("Timeline.Painting.PaintSetup", "ignored");
        map.put("Timeline.Rendering.ActivateLayerTree", "ignored");
        map.put("Timeline.Rendering.DrawFrame", "ignored");
        map.put("Timeline.Rendering.RequestMainThreadFrame", "ignored");
        map.put("Timeline.Rendering.BeginFrame", "ignored");
        map.put("Timeline.Scripting.TimeStamp", "we put those");

        map.put("Timeline.Other.UpdateLayerTree", "metric with wrong name in old goldfiles");

        map.put("WallTime", "fluctuates");

        METRICS_TO_EXCLUDE = ImmutableMap.copyOf(map);
    }

    protected PerfMetricsComparator() {
    }

    /**
     * Compares expected and actual metrics
     * 
     * @return null if actual metrics are within allowed bounds, else a message describing why they are considered
     *         different
     */
    public final String compare(PerfMetrics expectedMetrics, PerfMetrics actualMetrics) {
        StringBuilder em = new StringBuilder();
        StringBuilder log = new StringBuilder();
        Set<String> expectedMetricNames = expectedMetrics.getAllMetricNames();
        int numMetrics = expectedMetricNames.size();
        int numMetricsCompared = 0;

        for (String name : expectedMetricNames) {
            PerfMetric expected = expectedMetrics.getMetric(name);
            PerfMetric actual = actualMetrics.getNonnullMetric(name);

            int expectedValue = expected.getIntValue();
            int actualValue = (actual != null) ? actual.getIntValue() : -1;

            int allowedDelta = 0;
            int allowedPercent = getAllowedVariability(name);
            // TODO: put the % if the log comparison message
            if (allowedPercent != 0) {
                allowedDelta = Math.round((expectedValue * allowedPercent) / 100);
                if (allowedDelta == 0 && allowedPercent > 0) {
                    allowedDelta = 1; // allow at least 1 if non-zero %
                }
            }

            StringBuilder logLine = new StringBuilder(name + '[' + expectedValue);
            char logLineMark; // '=' metric in bounds, '*' metric out-of-bounds/missing, ' ' metric excluded
            if (actual == null || expectedValue != actualValue) {
                logLine.append("->");
            }
            if (actual != null && expectedValue != actualValue) {
                logLine.append(actualValue);
                if (actual instanceof MedianPerfMetric) {
                    logLine.append(' ');
                    logLine.append(((MedianPerfMetric) actual).toSequenceString());
                }
            }
            logLine.append(']');

            String excludedReason = getExcludedMetricMessage(name);
            if (excludedReason != null) {
                logLineMark = ' ';
                logLine.append(" excluded: " + excludedReason);
            } else if (isUnitExcluded(expected.getUnits())) {
                logLineMark = ' ';
                logLine.append(" excluded");
            } else if (IGNORE_PROFILE_JSCPU_IF_ZERO && actualValue == 0 && expectedValue != 0) {
                logLineMark = ' ';
                logLine.append(" excluded, chromedriver used doesn't support profiling");
            } else if (Math.abs(expectedValue - actualValue) > allowedDelta) {
                logLineMark = '*';
                numMetricsCompared++;
                em.append("--> perf metric out of range: " + name);
                String units = expected.getUnits();
                if (units != null) {
                    em.append(' ' + units);
                }
                em.append(" - expected " + expectedValue + ", actual " + actualValue);
                if (actual instanceof MedianPerfMetric) {
                    em.append(' ');
                    em.append(((MedianPerfMetric) actual).toSequenceString());
                }
                em.append(" (allowed variability " + allowedPercent + "%)");
                em.append('\n');
                String expectedDetails = expected.toDetailsText("expected");
                if (expectedDetails != null) {
                    em.append(expectedDetails);
                    em.append('\n');
                }
                String actualDetails = actual.toDetailsText("actual");
                if (actualDetails != null) {
                    em.append(actualDetails);
                    em.append('\n');
                }

                logLine.append(" OUT-OF-RANGE");
            } else {
                logLineMark = '=';
                numMetricsCompared++;
            }
            log.append("\n    " + logLineMark + ' ' + logLine);

            // TODO: fail if there are new metrics?
            // (this way the gold files will be updated with the extra info)

            // TODO: non-int perf value types?
        }

        String differences = (em.length() > 0) ? em.toString().trim() : null;

        // log a message showing what was really compared, i.e.:
        // "3 metrics compared: Paint[8->9*]
        String legend = "\n    (first column: '=' metric within bounds, '*' metric out of bounds or missing, ' ' metric not compared)";
        String logMessage = String.valueOf(numMetricsCompared) + '/' + numMetrics + " metrics compared: " + legend
                + log;
        LOG.info(logMessage);

        return differences;
    }
}
