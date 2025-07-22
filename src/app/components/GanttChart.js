"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  format,
  addDays,
  differenceInDays,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfYear,
  endOfYear,
  eachDayOfInterval,
  eachWeekOfInterval,
  eachMonthOfInterval,
  eachYearOfInterval,
  min,
  max,
  addMonths,
  addYears,
  differenceInMonths,
  differenceInYears,
} from "date-fns";
import {
  estimate,
  subJobs,
  estimateCostCentres,
  subJobCostCentres,
  subTasks,
} from "../data/sample";
import processData from "../data/transformData";

const { data: initialTasks } = processData(
  estimate,
  estimateCostCentres,
  subJobs,
  subJobCostCentres,
  subTasks
);

// Helper to get dates for the view mode with fixed cell widths
const getDatesForView = (startDate, endDate, viewMode) => {
  // Add defensive check for invalid dates
  if (!startDate || !endDate || isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    return []; // Return empty array if dates are invalid
  }

  switch (viewMode) {
    case "day":
      return eachDayOfInterval({ start: startDate, end: endDate });
    case "week":
      return eachWeekOfInterval(
        { start: startDate, end: endDate },
        { weekStartsOn: 0 }
      ).map((weekStart) => ({
        start: weekStart,
        end: endOfWeek(weekStart, { weekStartsOn: 0 }),
      }));
    case "month":
      return eachMonthOfInterval({ start: startDate, end: endDate });
    case "year":
      return eachYearOfInterval({ start: startDate, end: endDate });
    default:
      return eachDayOfInterval({ start: startDate, end: endDate });
  }
};

const getTimelineRange = (tasks, viewMode) => {
  if (!tasks.length) {
    const today = new Date();
    return { start: today, end: today };
  }
  const minDate = min(tasks.map((task) => task.startDate));
  const maxDate = max(tasks.map((task) => task.endDate));

  switch (viewMode) {
    case "day":
      return {
        start: addDays(minDate, -3),
        end: addDays(maxDate, 15),
      };
    case "week":
      return {
        start: startOfWeek(minDate, { weekStartsOn: 0 }),
        end: addDays(startOfWeek(minDate, { weekStartsOn: 0 }), 7 * 12 - 1),
      };
    case "month":
      return {
        start: startOfMonth(minDate),
        end: addMonths(startOfMonth(minDate), 11),
      };
    case "year":
      return {
        start: startOfYear(minDate),
        end: addYears(startOfYear(minDate), 4),
      };
    default:
      return {
        start: addDays(minDate, -3),
        end: addDays(maxDate, 15),
      };
  }
};

const GanttChart = () => {
  const getChildTasks = useCallback((parentId, allTasks) => {
    const children = allTasks.filter((task) => task.parentId === parentId);
    return children.concat(
      ...children.map((child) => getChildTasks(child.id, allTasks))
    );
  }, []);

  const calculateParentTasks = useCallback(
    (currentTasks) => {
      let tasksChanged = false;
      const updatedTasks = currentTasks.map((task) => ({ ...task }));
      const taskMap = new Map(updatedTasks.map((task) => [task.id, task]));

      updatedTasks.forEach((task) => {
        if (!task.isParent && task.progress === undefined) {
          task.progress = 0;
        }
      });

      const calculateProgressAndDatesRecursive = (taskId) => {
        const task = taskMap.get(taskId);
        if (!task) {
          return { progress: 0, startDate: null, endDate: null };
        }

        const children = getChildTasks(taskId, updatedTasks);

        if (children.length === 0) {
          // If it's a parent with no children, its progress is 0, and dates are its own
          if (task.isParent) {
            if (task.progress !== 0) {
              task.progress = 0;
              tasksChanged = true;
            }
            // A parent with no children should have its own dates if set, or null if not.
            // No change needed for dates if no children to derive from.
          }
          return {
            progress: task.progress,
            startDate: task.startDate,
            endDate: task.endDate,
          };
        }

        let totalProgress = 0;
        let totalDuration = 0;
        let allChildStartDates = [];
        let allChildEndDates = [];

        children.forEach((child) => {
          const {
            progress: childProgress,
            startDate: childStartDate,
            endDate: childEndDate,
          } = calculateProgressAndDatesRecursive(child.id);

          if (childStartDate) {
            allChildStartDates.push(childStartDate);
          }
          if (childEndDate) {
            allChildEndDates.push(childEndDate);
          }

          const duration = differenceInDays(child.endDate, child.startDate) + 1;
          totalProgress += (childProgress / 100) * duration;
          totalDuration += duration;
        });

        // Correctly use min and max by passing an array
        let minChildDate = allChildStartDates.length > 0 ? min(allChildStartDates) : null;
        let maxChildDate = allChildEndDates.length > 0 ? max(allChildEndDates) : null;

        // Update progress for parent tasks
        let newParentProgress = 0;
        if (totalDuration > 0) {
          newParentProgress = Math.round((totalProgress / totalDuration) * 100);
        }
        if (task.progress !== newParentProgress) {
          task.progress = newParentProgress;
          tasksChanged = true;
        }

        // Update dates for parent tasks
        if (task.startDate?.getTime() !== minChildDate?.getTime()) {
          task.startDate = minChildDate;
          tasksChanged = true;
        }
        if (task.endDate?.getTime() !== maxChildDate?.getTime()) {
          task.endDate = maxChildDate;
          tasksChanged = true;
        }

        return {
          progress: task.progress,
          startDate: task.startDate,
          endDate: task.endDate,
        };
      };

      // Process tasks from deepest children upwards to ensure parent dates are calculated correctly
      // This loop processes all tasks, ensuring children are processed before parents.
      for (let i = updatedTasks.length - 1; i >= 0; i--) {
        const task = updatedTasks[i];
        if (task.isParent) {
          calculateProgressAndDatesRecursive(task.id);
        }
      }

      // Re-run for top-level parents to ensure they are also updated
      updatedTasks
        .filter((task) => task.isParent && !task.parentId)
        .forEach((task) => calculateProgressAndDatesRecursive(task.id));

      return tasksChanged ? updatedTasks : currentTasks;
    },
    [getChildTasks]
  );

  const [tasks, setTasks] = useState(() => {
    const processed = initialTasks.map((task) => ({
      ...task,
      progress: task.progress || 0,
      collapsed: task.collapsed !== undefined ? task.collapsed : false,
    }));
    return calculateParentTasks(processed);
  });

  const [viewMode, setViewMode] = useState("day");
  const [draggingTask, setDraggingTask] = useState(null);
  const [resizingTask, setResizingTask] = useState(null);
  const [progressAdjustingTask, setProgressAdjustingTask] = useState(null);
  const [dragOffset, setDragOffset] = useState(0);
  const [resizeStartMouseX, setResizeStartMouseX] = useState(0);
  const [originalTaskStartDate, setOriginalTaskStartDate] = useState(null);
  const [originalTaskEndDate, setOriginalTaskEndDate] = useState(null);
  const [chartStartDate, setChartStartDate] = useState(new Date());
  const [chartEndDate, setChartEndDate] = useState(new Date());

  const taskListRef = useRef(null);
  const ganttChartRef = useRef(null);
  const timelineRef = useRef(null);
  const ganttContentRef = useRef(null);

  useEffect(() => {
    const { start, end } = getTimelineRange(tasks, viewMode);
    setChartStartDate(start);
    setChartEndDate(end);
  }, [tasks, viewMode]);

  const getPixelsPerUnit = useCallback(() => {
    switch (viewMode) {
      case "day":
        return 50;
      case "week":
        return 150;
      case "month":
        return 150;
      case "year":
        return 300;
      default:
        return 50;
    }
  }, [viewMode]);

  useEffect(() => {
    setTasks((prevTasks) => calculateParentTasks(prevTasks));
  }, [tasks, calculateParentTasks]);
  const getTaskBarProps = useCallback(
    (task) => {
      const pixelsPerUnit = getPixelsPerUnit();

      let startOffsetUnits = 0;
      let totalUnits = 0;

      switch (viewMode) {
        case "day":
          startOffsetUnits = differenceInDays(task.startDate, chartStartDate);
          totalUnits = differenceInDays(task.endDate, task.startDate) + 1;
          break;
        case "week":
          const startWeek = startOfWeek(task.startDate, { weekStartsOn: 0 });
          const endWeek = endOfWeek(task.endDate, { weekStartsOn: 0 });
          const chartStartWeek = startOfWeek(chartStartDate, {
            weekStartsOn: 0,
          });
          startOffsetUnits = differenceInDays(startWeek, chartStartWeek) / 7;
          totalUnits = differenceInDays(endWeek, startWeek) / 7 + 1;
          break;
        case "month":
          let currentMonthOffset = startOfMonth(chartStartDate);
          while (currentMonthOffset < startOfMonth(task.startDate)) {
            startOffsetUnits++;
            currentMonthOffset = addMonths(currentMonthOffset, 1);
          }
          let currentMonthDuration = startOfMonth(task.startDate);
          while (currentMonthDuration <= startOfMonth(task.endDate)) {
            totalUnits++;
            currentMonthDuration = addMonths(currentMonthDuration, 1);
          }
          break;
        case "year":
          let currentYearOffset = startOfYear(chartStartDate);
          while (currentYearOffset < startOfYear(task.startDate)) {
            startOffsetUnits++;
            currentYearOffset = addYears(currentYearOffset, 1);
          }
          let currentYearDuration = startOfYear(task.startDate);
          while (currentYearDuration <= startOfYear(task.endDate)) {
            totalUnits++;
            currentYearDuration = addYears(currentYearDuration, 1);
          }
          break;
        default:
          startOffsetUnits = differenceInDays(task.startDate, chartStartDate);
          totalUnits = differenceInDays(task.endDate, task.startDate) + 1;
      }

      const left = startOffsetUnits * pixelsPerUnit;
      const width = totalUnits * pixelsPerUnit;

      return { left, width };
    },
    [viewMode, chartStartDate, getPixelsPerUnit]
  );

  const handleAutoScroll = useCallback((clientX) => {
    if (!ganttContentRef.current) return;

    const rect = ganttContentRef.current.getBoundingClientRect();
    const scrollThreshold = 50;
    const scrollSpeed = 10;

    if (clientX < rect.left + scrollThreshold) {
      ganttContentRef.current.scrollLeft = Math.max(
        0,
        ganttContentRef.current.scrollLeft - scrollSpeed
      );
    } else if (clientX > rect.right - scrollThreshold) {
      ganttContentRef.current.scrollLeft += scrollSpeed;
    }
  }, []);

  const handleMouseDown = useCallback(
    (e, taskId, type) => {
      e.preventDefault();
      e.stopPropagation();
      const taskElement = e.currentTarget.closest(".task-bar");
      const rect = taskElement.getBoundingClientRect();
      const task = tasks.find((t) => t.id === taskId);

      if (type === "drag") {
        setDraggingTask({
          id: taskId,
          initialX: e.clientX,
          initialLeft: rect.left,
        });
        setDragOffset(e.clientX - rect.left);
      } else if (type === "resize-left") {
        setResizingTask({ id: taskId, type: "left" });
        setResizeStartMouseX(e.clientX);
        setOriginalTaskStartDate(task.startDate);
        setOriginalTaskEndDate(task.endDate);
      } else if (type === "resize-right") {
        setResizingTask({ id: taskId, type: "right" });
        setResizeStartMouseX(e.clientX);
        setOriginalTaskStartDate(task.startDate);
        setOriginalTaskEndDate(task.endDate);
      } else if (type === "progress" && !task.isParent) {
        setProgressAdjustingTask({
          id: taskId,
          initialX: e.clientX,
          initialProgress: task.progress,
          taskBarWidth: rect.width,
        });
      }
    },
    [tasks]
  );

  const handleMouseMove = useCallback(
    (e) => {
      e.preventDefault();
      const pixelsPerUnit = getPixelsPerUnit();

      if (draggingTask || resizingTask || progressAdjustingTask) {
        handleAutoScroll(e.clientX);
      }

      if (draggingTask) {
        const { id } = draggingTask;
        const currentTask = tasks.find((t) => t.id === id);
        if (!currentTask) return;

        const timelineRect = ganttContentRef.current.getBoundingClientRect();
        const newX =
          e.clientX -
          timelineRect.left -
          dragOffset +
          ganttContentRef.current.scrollLeft;
        let unitsMoved;
        let newStartDate;
        let newEndDate;

        switch (viewMode) {
          case "day":
            unitsMoved = Math.round(newX / pixelsPerUnit);
            newStartDate = addDays(chartStartDate, unitsMoved);
            newEndDate = addDays(
              newStartDate,
              differenceInDays(currentTask.endDate, currentTask.startDate)
            );
            break;
          case "week":
            unitsMoved = Math.round(newX / pixelsPerUnit);
            const currentWeekStart = startOfWeek(chartStartDate, {
              weekStartsOn: 0,
            });
            newStartDate = addDays(currentWeekStart, unitsMoved * 7);
            newEndDate = addDays(
              newStartDate,
              differenceInDays(currentTask.endDate, currentTask.startDate)
            );
            break;
          case "month":
            unitsMoved = Math.round(newX / pixelsPerUnit);
            const currentMonthStart = startOfMonth(chartStartDate);
            const durationMonths = differenceInMonths(
              currentTask.endDate,
              currentTask.startDate
            );
            newStartDate = addMonths(currentMonthStart, unitsMoved);
            newEndDate = addMonths(newStartDate, durationMonths);
            break;
          case "year":
            unitsMoved = Math.round(newX / pixelsPerUnit);
            const currentYearStart = startOfYear(chartStartDate);
            const durationYears = differenceInYears(
              currentTask.endDate,
              currentTask.startDate
            );
            newStartDate = addYears(currentYearStart, unitsMoved);
            newEndDate = addYears(newStartDate, durationYears);
            break;
          default:
            unitsMoved = Math.round(newX / pixelsPerUnit);
            newStartDate = addDays(chartStartDate, unitsMoved);
            newEndDate = addDays(
              newStartDate,
              differenceInDays(currentTask.endDate, currentTask.startDate)
            );
        }

        setTasks((prevTasks) => {
          const updated = prevTasks.map((task) =>
            task.id === id && !task.isParent
              ? { ...task, startDate: newStartDate, endDate: newEndDate }
              : task
          );
          return calculateParentTasks(updated); // Recalculate parent tasks after child change
        });
      } else if (resizingTask) {
        const { id, type } = resizingTask;
        const currentTask = tasks.find((t) => t.id === id);
        if (!currentTask) return;

        const deltaX = e.clientX - resizeStartMouseX;
        let deltaUnits;
        let newStartDate = originalTaskStartDate;
        let newEndDate = originalTaskEndDate;

        switch (viewMode) {
          case "day":
            deltaUnits = Math.round(deltaX / pixelsPerUnit);
            if (type === "left") {
              newStartDate = addDays(originalTaskStartDate, deltaUnits);
              if (newStartDate > newEndDate) newStartDate = newEndDate;
            } else if (type === "right") {
              newEndDate = addDays(originalTaskEndDate, deltaUnits);
              if (newEndDate < newStartDate) newEndDate = newStartDate;
            }
            break;
          case "week":
            deltaUnits = Math.round(deltaX / pixelsPerUnit);
            if (type === "left") {
              newStartDate = addDays(originalTaskStartDate, deltaUnits * 7);
              if (newStartDate > newEndDate) newStartDate = newEndDate;
            } else if (type === "right") {
              newEndDate = addDays(originalTaskEndDate, deltaUnits * 7);
              if (newEndDate < newStartDate) newEndDate = newStartDate;
            }
            break;
          case "month":
            deltaUnits = Math.round(deltaX / pixelsPerUnit);
            if (type === "left") {
              newStartDate = addMonths(originalTaskStartDate, deltaUnits);
              if (newStartDate > newEndDate) newStartDate = newEndDate;
            } else if (type === "right") {
              newEndDate = addMonths(originalTaskEndDate, deltaUnits);
              if (newEndDate < newStartDate) newEndDate = newStartDate;
            }
            break;
          case "year":
            deltaUnits = Math.round(deltaX / pixelsPerUnit);
            if (type === "left") {
              newStartDate = addYears(originalTaskStartDate, deltaUnits);
              if (newStartDate > newEndDate) newStartDate = newEndDate;
            } else if (type === "right") {
              newEndDate = addYears(originalTaskEndDate, deltaUnits);
              if (newEndDate < newStartDate) newEndDate = newStartDate;
            }
            break;
          default:
            deltaUnits = Math.round(deltaX / pixelsPerUnit);
            if (type === "left") {
              newStartDate = addDays(originalTaskStartDate, deltaUnits);
              if (newStartDate > newEndDate) newStartDate = newEndDate;
            } else if (type === "right") {
              newEndDate = addDays(originalTaskEndDate, deltaUnits);
              if (newEndDate < newStartDate) newEndDate = newStartDate;
            }
            break;
        }

        setTasks((prevTasks) => {
          const updated = prevTasks.map((task) => {
            if (task.id === id && !task.isParent) {
              return { ...task, startDate: newStartDate, endDate: newEndDate };
            }
            return task;
          });
          return calculateParentTasks(updated); // Recalculate parent tasks after child change
        });
      } else if (progressAdjustingTask) {
        const { id, initialX, initialProgress, taskBarWidth } =
          progressAdjustingTask;
        const deltaX = e.clientX - initialX;
        let newProgress = initialProgress + (deltaX / taskBarWidth) * 100;
        newProgress = Math.max(0, Math.min(100, newProgress));

        setTasks((prevTasks) => {
          const updated = prevTasks.map((task) =>
            task.id === id
              ? { ...task, progress: Math.round(newProgress) }
              : task
          );
          return calculateParentTasks(updated); // Recalculate parent tasks after child change
        });
      }
    },
    [
      draggingTask,
      resizingTask,
      progressAdjustingTask,
      tasks,
      chartStartDate,
      originalTaskStartDate,
      originalTaskEndDate,
      resizeStartMouseX,
      dragOffset,
      getPixelsPerUnit,
      viewMode,
      handleAutoScroll,
      calculateParentTasks,
    ]
  );

  const handleMouseUp = useCallback(() => {
    setDraggingTask(null);
    setResizingTask(null);
    setProgressAdjustingTask(null);
  }, []);

  useEffect(() => {
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  const toggleCollapse = useCallback((taskId) => {
    setTasks((prevTasks) =>
      prevTasks.map((task) =>
        task.id === taskId ? { ...task, collapsed: !task.collapsed } : task
      )
    );
  }, []);

  const getVisibleTasks = useCallback((allTasks) => {
    const visibleTasks = [];
    const collapsedParents = new Set();

    allTasks.forEach((task) => {
      if (task.isParent && task.collapsed) {
        collapsedParents.add(task.id);
      }
    });

    allTasks.forEach((task) => {
      let isVisible = true;
      let currentParentId = task.parentId;
      while (currentParentId) {
        if (collapsedParents.has(currentParentId)) {
          isVisible = false;
          break;
        }
        const parentTask = allTasks.find((t) => t.id === currentParentId);
        currentParentId = parentTask ? parentTask.parentId : null;
      }
      if (isVisible) {
        visibleTasks.push(task);
      }
    });
    return visibleTasks;
  }, []);

  const visibleTasks = getVisibleTasks(tasks);

  // Synchronize scroll between task list and gantt chart content (vertical)
  const handleTaskListScroll = useCallback(() => {
    if (taskListRef.current && ganttContentRef.current) {
      ganttContentRef.current.scrollTop = taskListRef.current.scrollTop;
    }
  }, []);

  const handleGanttContentScroll = useCallback(() => {
    if (ganttContentRef.current && taskListRef.current) {
      taskListRef.current.scrollTop = ganttContentRef.current.scrollTop;
    }
  }, []);

  // Synchronize horizontal scroll between gantt content and timeline header
  const handleGanttContentHorizontalScroll = useCallback(() => {
    if (ganttContentRef.current && timelineRef.current) {
      timelineRef.current.scrollLeft = ganttContentRef.current.scrollLeft;
    }
  }, []);

  useEffect(() => {
    const taskList = taskListRef.current;
    const ganttContent = ganttContentRef.current;
    const timeline = timelineRef.current;

    if (taskList) {
      taskList.addEventListener("scroll", handleTaskListScroll);
    }
    if (ganttContent) {
      ganttContent.addEventListener("scroll", handleGanttContentScroll);
      ganttContent.addEventListener(
        "scroll",
        handleGanttContentHorizontalScroll
      );
    }

    return () => {
      if (taskList)
        taskList.removeEventListener("scroll", handleTaskListScroll);
      if (ganttContent) {
        ganttContent.removeEventListener("scroll", handleGanttContentScroll);
        ganttContent.removeEventListener(
          "scroll",
          handleGanttContentHorizontalScroll
        );
      }
    };
  }, [
    handleTaskListScroll,
    handleGanttContentScroll,
    handleGanttContentHorizontalScroll,
  ]);

  const renderTimelineHeader = () => {
    const dates = getDatesForView(chartStartDate, chartEndDate, viewMode);
    const pixelsPerUnit = getPixelsPerUnit();

    return (
      <div
        className="flex border-b border-gray-300 bg-gray-100"
        style={{ width: (Array.isArray(dates) ? dates.length : 0) * pixelsPerUnit }}
      >
        {(Array.isArray(dates) ? dates : []).map((item, index) => {
          let label = "";
          let width = pixelsPerUnit;
          let className =
            "flex-shrink-0 flex items-center justify-center text-xs font-medium text-gray-700 border-r border-gray-200 h-10";

          switch (viewMode) {
            case "day":
              label = format(item, "MMM dd");
              break;
            case "week":
              label = `${format(item.start, "MMM dd")} - ${format(
                item.end,
                "MMM dd"
              )}`;
              break;
            case "month":
              label = format(item, "MMM yyyy");
              break;
            case "year":
              label = format(item, "yyyy");
              break;
            default:
              label = format(item, "MMM dd");
          }

          return (
            <div
              key={index}
              className={className}
              style={{ width: `${width}px` }}
            >
              {label}
            </div>
          );
        })}
      </div>
    );
  };

  const renderTaskList = () => {
    const getPaddingLeft = (taskId) => {
      let level = 0;
      let currentTask = tasks.find((t) => t.id === taskId);
      while (currentTask && currentTask.parentId) {
        level++;
        currentTask = tasks.find((t) => t.id === currentTask.parentId);
      }
      return level * 10;
    };

    const handleDateChange = (taskId, field, dateString) => {
      const newDate = new Date(dateString);
      if (isNaN(newDate.getTime())) {
        return;
      }

      setTasks((prevTasks) => {
        const updatedTasks = prevTasks.map((task) => {
          if (task.id === taskId && !task.isParent) { // Only allow editing for non-parent tasks
            const updatedTask = { ...task, [field]: newDate };

            // Change start date > current end date, recalculate end date based on the original duration
            if (
              field === "startDate" &&
              updatedTask.startDate &&
              updatedTask.endDate &&
              updatedTask.startDate > updatedTask.endDate
            ) {
              const originalDuration = differenceInDays(
                task.endDate,
                task.startDate
              );
              updatedTask.endDate = addDays(
                updatedTask.startDate,
                originalDuration
              );
            }
            // Change end date > current start date, recalculate the start date based on the original duration.
            else if (
              field === "endDate" &&
              updatedTask.startDate &&
              updatedTask.endDate &&
              updatedTask.endDate < updatedTask.startDate
            ) {
              const originalDuration = differenceInDays(
                task.endDate,
                task.startDate
              );
              updatedTask.startDate = addDays(
                updatedTask.endDate,
                -originalDuration
              );
            }

            return updatedTask;
          }
          return task;
        });
        return calculateParentTasks(updatedTasks); // Recalculate parent tasks after child change
      });
    };

    const handleProgressChange = (taskId, value) => {
      let newProgress = parseInt(value, 10);
      if (isNaN(newProgress) || newProgress < 0) newProgress = 0;
      if (newProgress > 100) newProgress = 100;

      setTasks((prevTasks) => {
        const updated = prevTasks.map((task) =>
          task.id === taskId ? { ...task, progress: newProgress } : task
        );
        return calculateParentTasks(updated); // Recalculate parent tasks after child change
      });
    };

    return (
      <div
        className="flex-shrink-0 border-r border-gray-300 bg-white sticky left-0 z-20 overflow-y-hidden"
        ref={taskListRef}
        style={{ width: "40vw", height: "100%" }}
      >
        <div className="h-10 text-sm flex items-center px-4 font-semibold text-gray-800 border-b border-gray-300 sticky top-0 bg-white z-10">
          <span className="w-36 flex-grow">Task Name</span>
          <span className="w-28 text-left">Start Date</span>
          <span className="w-28 text-left">Finish Date</span>
          <span className="w-16 text-center">Days</span>
          <span className="w-16 text-center">%</span>
        </div>
        <div>
          {visibleTasks.map((task) => (
            <div
              key={task.id}
              className="flex items-center h-10 px-4 border-b border-gray-200 hover:bg-gray-50"
            >
              {task.isParent && (
                <button
                  onClick={() => toggleCollapse(task.id)}
                  className="text-gray-500 hover:text-gray-700 focus:outline-none"
                  style={{ paddingLeft: `${getPaddingLeft(task.id)}px` }}
                >
                  <svg
                    className={`w-4 h-4 transform transition-transform duration-200 ${
                      task.collapsed ? "rotate-90" : ""
                    }`}
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
              )}
              <span
                className="text-xs text-gray-900 truncate flex-grow"
                style={{ paddingLeft: `${getPaddingLeft(task.id)}px` }}
              >
                {task.name}
              </span>
              {/* Start Date */}
              <span className="w-28 text-center p-2 flex items-center justify-start">
                <input
                  type="date"
                  value={
                    task.startDate ? format(task.startDate, "yyyy-MM-dd") : ""
                  }
                  onChange={(e) =>
                    handleDateChange(task.id, "startDate", e.target.value)
                  }
                  className={`text-xs w-full text-center border-none bg-transparent ${
                    task.isParent ? "text-gray-400" : "text-gray-600"
                  }`}
                  disabled={task.isParent}
                />
              </span>
              {/* Finish Date */}
              <span className="w-28 text-center p-2 flex items-center justify-start">
                <input
                  type="date"
                  value={task.endDate ? format(task.endDate, "yyyy-MM-dd") : ""}
                  onChange={(e) =>
                    handleDateChange(task.id, "endDate", e.target.value)
                  }
                  className={`text-xs w-full text-center border-none bg-transparent ${
                    task.isParent ? "text-gray-400" : "text-gray-600"
                  }`}
                  disabled={task.isParent}
                />
              </span>
              {/* Duration */}
              <span className="text-xs text-gray-600 w-12 p-2 text-right flex items-center justify-end">
                {task.startDate && task.endDate
                  ? differenceInDays(task.endDate, task.startDate) + 1
                  : 0}{" "}
                d
              </span>
              {/* Progress */}
              <span className="w-16 text-right p-2 flex items-center justify-end">
                <input
                  type="number"
                  value={task.progress}
                  onChange={(e) =>
                    handleProgressChange(task.id, e.target.value)
                  }
                  className={`text-xs w-full text-right border-none bg-transparent ${
                    task.isParent ? "text-gray-400" : "text-gray-600"
                  }`}
                  min="0"
                  max="100"
                  disabled={task.isParent}
                />
                <span className="text-xs text-gray-600">%</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderGanttChartGrid = () => {
    const dates = getDatesForView(chartStartDate, chartEndDate, viewMode);
    const pixelsPerUnit = getPixelsPerUnit();

    return (
      <div
        className="flex-grow relative overflow-auto"
        ref={ganttContentRef}
        style={{ height: "100%" }}
      >
        <div
          className="absolute inset-0 flex"
          style={{ width: (Array.isArray(dates) ? dates.length : 0) * pixelsPerUnit, minWidth: "65vw" }}
        >
          {(Array.isArray(dates) ? dates : []).map((item, index) => (
            <div
              key={`grid-${index}`}
              className="flex-shrink-0 border-r border-gray-200"
              style={{
                width: `${pixelsPerUnit}px`,
                height: `${visibleTasks.length * 40}px`,
              }}
            ></div>
          ))}
        </div>

        <div
          className="relative"
          style={{
            height: `${visibleTasks.length * 40}px`,
            width: (Array.isArray(dates) ? dates.length : 0) * pixelsPerUnit,
            minWidth: "65vw",
          }}
        >
          {visibleTasks.map((task, index) => {
            if (!task.startDate || !task.endDate) return null;
            const { left, width } = getTaskBarProps(task);
            const isParent = task.isParent;
            // The progress bar for a parent is visually represented by its children's progress.
            // However, the 'progressWidth' here is for the *visual fill* of the bar itself,
            // which for parents will be based on their aggregated progress.
            const progressWidth = (task.progress / 100) * width; // Now apply to parents too

            return (
              <div
                key={task.id}
                className={`task-bar absolute h-8 rounded-md shadow-sm ${
                  isParent
                    ? "bg-blue-200 border border-blue-400"
                    : "bg-green-500"
                }`}
                style={{
                  top: `${index * 40 + 6}px`,
                  left: `${left}px`,
                  width: `${width}px`,
                  zIndex:
                    draggingTask?.id === task.id ||
                    resizingTask?.id === task.id ||
                    progressAdjustingTask?.id === task.id
                      ? 20
                      : 10,
                }}
                data-task-id={task.id}
                onMouseDown={(e) => handleMouseDown(e, task.id, "drag")}
              >
                {/* Always show the progress fill for both parents and non-parents */}
                <div
                  className={`absolute top-0 left-0 h-full rounded-md ${isParent ? "bg-blue-600" : "bg-green-700"}`} // Different color for parent progress
                  style={{ width: `${progressWidth}px` }}
                ></div>
                {/* Progress adjust handle only for non-parent tasks */}
                {!isParent && (
                  <div
                    className="absolute top-0 w-3 h-full cursor-ew-resize bg-green-800 rounded-r-md opacity-70 hover:opacity-100"
                    onMouseDown={(e) =>
                      handleMouseDown(e, task.id, "progress")
                    }
                    style={{
                      left: `${progressWidth - 4}px`,
                      width: "8px",
                      zIndex: 30,
                    }}
                  ></div>
                )}

                <div
                  className="absolute top-0 left-0 w-2 h-full cursor-ew-resize rounded-l-md opacity-0 hover:opacity-100 bg-gray-700"
                  onMouseDown={(e) =>
                    handleMouseDown(e, task.id, "resize-left")
                  }
                ></div>
                <div
                  className="absolute top-0 right-0 w-2 h-full cursor-ew-resize rounded-r-md opacity-0 hover:opacity-100 bg-gray-700"
                  onMouseDown={(e) =>
                    handleMouseDown(e, task.id, "resize-right")
                  }
                ></div>

                <span
                  className={`absolute px-2 py-1 text-xs font-semibold ${
                    isParent ? "text-blue-800" : "text-white"
                  } truncate`}
                  style={{
                    left: "50%",
                    transform: "translate(-50%, -50%)",
                    top: "50%",
                    pointerEvents: "none",
                  }}
                >
                  {task.name}
                  {/* Display progress for both parent and non-parent tasks */}
                  {task.startDate && task.endDate && (
                    <span className={`ml-1 ${isParent ? "text-blue-600" : "text-white"}`}>
                      ({task.progress}%)
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="font-sans antialiased bg-gray-100 min-h-screen p-4">
      <div
        className="max-w-full mx-auto bg-white rounded-lg shadow-xl overflow-hidden"
        style={{ height: "95vh" }}
      >
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-800">
            Project Gantt Chart
          </h1>
          <div className="flex space-x-2">
            {["day", "week", "month", "year"].map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors duration-200
                ${
                  viewMode === mode
                    ? "bg-blue-600 text-white shadow-md"
                    : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                }`}
              >
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="flex relative" style={{ height: "calc(95vh - 72px)" }}>
          {renderTaskList()}
          <div
            className="flex flex-col flex-grow overflow-hidden"
            ref={ganttChartRef}
          >
            <div
              ref={timelineRef}
              className="overflow-x-hidden overflow-y-hidden sticky top-0 z-20"
            >
              {renderTimelineHeader()}
            </div>
            {renderGanttChartGrid()}
          </div>
        </div>
      </div>
    </div>
  );
};

export default GanttChart;