const parseDate = (dateString) => {
  if (!dateString) return new Date();
  const parts = dateString.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!parts) {
    console.warn(`Could not parse date string: ${dateString}`);
    return new Date();
  }
  const [, month, day, year] = parts;
  return new Date(year, month - 1, day);
};

const processData = (
  estimate,
  estimateCostCentres,
  subJobs,
  subJobCostCentres,
  subTasks
) => {
  const tasks = [];
  let taskIdCounter = 1;

  // 1. Add the main Job (Estimate)
  const jobTask = {
    id: `job-${estimate.ID}`,
    name: estimate.Original_Estimate.display_value || "Main Job",
    startDate: null,
    endDate: null,
    progress: 0,
    isParent: true,
    collapsed: false,
  };
  tasks.push(jobTask);

  // 2. Add Estimate Cost Centres
  estimateCostCentres.forEach((ecc) => {
    const startDate = parseDate(ecc.Start_Time) || new Date();
    const duration =
      ecc.Costs?.reduce((sum, cost) => sum + (cost.Hours || 1), 0) || 1;
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + duration - 1); // Adjust for inclusive duration

    const eccTask = {
      id: `ecc-${ecc.ID}`,
      name: ecc.Cost_Centre?.display_value || "Unknown Estimate Cost Centre",
      startDate,
      endDate,
      progress: 0,
      parentId: jobTask.id,
    };
    tasks.push(eccTask);
  });

  // 3. Add Sub Jobs
  subJobs.forEach((subJob) => {
    const subJobTask = {
      id: `subjob-${subJob.ID}`,
      name: subJob.Name || "Unknown Sub Job",
      startDate: null,
      endDate: null,
      progress: 0,
      isParent: true,
      collapsed: false,
      parentId: jobTask.id,
    };
    tasks.push(subJobTask);

    // 4. Add Sub Job Cost Centres
    subJobCostCentres
      .filter((sjcc) => sjcc.Sub_Job?.ID === subJob.ID)
      .forEach((sjcc) => {
        const startDate = parseDate(sjcc.Start_Time) || new Date();
        const duration =
          sjcc.Costs?.reduce((sum, cost) => sum + (cost.Hours || 1), 0) || 1;
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + duration - 1);

        const sjccTask = {
          id: `sjcc-${sjcc.ID}-${taskIdCounter++}`,
          name:
            sjcc.Cost_Centre?.display_value || "Unknown Sub Job Cost Centre",
          startDate,
          endDate,
          progress: 0,
          parentId: subJobTask.id,
        };
        tasks.push(sjccTask);
      });

    // 5. Add Sub Tasks
    subTasks
      .filter((st) => st.Sub_Job?.ID === subJob.ID)
      .forEach((subTask) => {
        const startDate = parseDate(subTask.Start_Time) || new Date();
        const duration =
          subTask.jobCenters?.reduce(
            (sum, center) =>
              sum +
              (center.Costs?.reduce(
                (csum, cost) => csum + (cost.Hours || 1),
                0
              ) || 1),
            0
          ) || 1;
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + duration - 1);

        const subTaskGantt = {
          id: `subtask-${subTask.ID}`,
          name: subTask.Name || "Unknown Sub Task",
          startDate,
          endDate,
          progress: 0,
          isParent: true,
          collapsed: false,
          parentId: subJobTask.id,
        };
        tasks.push(subTaskGantt);

        if (subTask.jobCenters && Array.isArray(subTask.jobCenters)) {
          subTask.jobCenters.forEach((center) => {
            const startDate = parseDate(center.Start_Time) || new Date();
            const duration =
              center.Costs?.reduce((sum, cost) => sum + (cost.Hours || 1), 0) ||
              1;
            const endDate = new Date(startDate);
            endDate.setDate(endDate.getDate() + duration - 1);

            const centerlineTask = {
              id: `subtask-center-${
                center.ID || center.Cost_Centre?.ID || taskIdCounter++
              }`,
              name:
                center.Cost_Centre?.display_value ||
                center.Job_Task?.display_value ||
                "Unknown Cost Centre",
              startDate,
              endDate,
              progress: 0,
              parentId: subTaskGantt.id,
            };
            tasks.push(centerlineTask);
          });
        }

        // 6. Add Sub Task Cost Centres
        subJobCostCentres
          .filter((stcc) => stcc.Job_Task?.ID === subTask.ID)
          .forEach((stcc) => {
            const startDate = parseDate(stcc.Start_Time) || new Date();
            const duration =
              stcc.Costs?.reduce((sum, cost) => sum + (cost.Hours || 1), 0) ||
              1;
            const endDate = new Date(startDate);
            endDate.setDate(endDate.getDate() + duration - 1);

            const stccTask = {
              id: `stcc-${stcc.ID}-${taskIdCounter++}`,
              name:
                stcc.Cost_Centre?.display_value ||
                "Unknown Sub Task Cost Centre",
              startDate,
              endDate,
              progress: 0,
              parentId: subTaskGantt.id,
            };
            tasks.push(stccTask);

            stcc.Costs?.forEach((cost) => {
              const startDate = parseDate(cost.Start_Time) || new Date();
              const duration = cost.Hours || 1;
              const endDate = new Date(startDate);
              endDate.setDate(endDate.getDate() + duration - 1);

              const costTask = {
                id: `stcc-cost-${cost.ID}-${taskIdCounter++}`,
                name: cost.Description || "Unknown Cost",
                startDate,
                endDate,
                progress: 0,
                parentId: stccTask.id,
              };
              tasks.push(costTask);
            });
          });
      });
  });

  // Calculate parent task dates
  const calculateParentDates = (tasks) => {
    const updatedTasks = [...tasks];
    const parentTasks = updatedTasks.filter((task) => task.isParent);

    parentTasks.forEach((parent) => {
      const children = updatedTasks.filter(
        (task) => task.parentId === parent.id
      );
      // Filter out children with invalid dates
      const validChildren = children.filter(
        (child) =>
          child.startDate instanceof Date &&
          !isNaN(child.startDate) &&
          child.endDate instanceof Date &&
          !isNaN(child.endDate)
      );
      if (validChildren.length > 0) {
        const earliestChildStart = new Date(
          Math.min(...validChildren.map((child) => child.startDate.getTime()))
        );
        const latestChildEnd = new Date(
          Math.max(...validChildren.map((child) => child.endDate.getTime()))
        );

        parent.startDate = earliestChildStart;
        parent.endDate = latestChildEnd;
      }
    });
    return updatedTasks;
  };

  const updatedTasks = calculateParentDates(tasks);
  return { data: updatedTasks, links: [] };
};

export default processData;
