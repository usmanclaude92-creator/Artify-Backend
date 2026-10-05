/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Phase 13: Autonomous AI Workflows & Business Automation
 * Automated Task Management Service
 */

import crypto from "node:crypto";
import type { AutomationTaskStatus } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { NotFoundError } from "../../core/errors";
import { auditLogRepository } from "../../repositories/auditLogRepository";
import { notificationService } from "../notificationService";
import { eventEngine } from "./EventEngine";

export class TaskManager {
  private static instance: TaskManager;

  public static getInstance(): TaskManager {
    if (!TaskManager.instance) {
      TaskManager.instance = new TaskManager();
    }
    return TaskManager.instance;
  }

  /**
   * Create a new automated task.
   */
  public async createTask(params: {
    organizationId: string;
    title: string;
    description?: string;
    assignedUserId?: string;
    assignedRole?: string;
    priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
    dueDate?: string | Date;
    sourceWorkflowId?: string;
    sourceExecutionId?: string;
    sourceEntityType?: string;
    sourceEntityId?: string;
    isAiGenerated?: boolean;
    metadata?: Record<string, unknown>;
  }) {
    const taskId = crypto.randomUUID();
    const dueDate = params.dueDate ? new Date(params.dueDate) : null;

    const task = await prisma.automationTask.create({
      data: {
        id: taskId,
        organizationId: params.organizationId,
        title: params.title,
        description: params.description || null,
        assignedUserId: params.assignedUserId || null,
        assignedRole: params.assignedRole || null,
        priority: params.priority || "MEDIUM",
        status: "PENDING",
        dueDate,
        sourceWorkflowId: params.sourceWorkflowId || null,
        sourceExecutionId: params.sourceExecutionId || null,
        sourceEntityType: params.sourceEntityType || null,
        sourceEntityId: params.sourceEntityId || null,
        isAiGenerated: params.isAiGenerated ?? true,
        metadata: (params.metadata || {}) as any,
      },
      include: {
        assignedUser: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });

    // Phase 16 — real in-app notification (reuses the existing core
    // Notification table/bell — no parallel notification system) to
    // whoever this task was just assigned to.
    if (task.assignedUserId) {
      await notificationService.notify({
        organizationId: params.organizationId,
        userId: task.assignedUserId,
        type: "task_assigned",
        title: "New task assigned to you",
        message: task.title,
        entityType: "automation_task",
        entityId: task.id,
      });
    }

    return task;
  }

  /**
   * Update task status or assignment.
   */
  public async updateTask(params: {
    taskId: string;
    organizationId: string;
    userId?: string;
    status?: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
    assignedUserId?: string;
    priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
    dueDate?: string | Date;
  }) {
    const task = await prisma.automationTask.findFirst({
      where: { id: params.taskId, organizationId: params.organizationId },
    });

    if (!task) {
      throw new NotFoundError("Automation task not found.");
    }

    const updateData: Record<string, any> = {};
    if (params.status) {
      updateData.status = params.status;
      if (params.status === "COMPLETED") {
        updateData.completedAt = new Date();
      }
    }
    if (params.assignedUserId !== undefined) {
      updateData.assignedUserId = params.assignedUserId;
    }
    if (params.priority) {
      updateData.priority = params.priority;
    }
    if (params.dueDate !== undefined) {
      updateData.dueDate = params.dueDate ? new Date(params.dueDate) : null;
    }

    const updated = await prisma.automationTask.update({
      where: { id: task.id },
      data: updateData,
      include: {
        assignedUser: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });

    if (params.userId) {
      await auditLogRepository.record({
        organizationId: params.organizationId,
        actorUserId: params.userId,
        actorType: "USER",
        action: "AUTOMATION_TASK_UPDATED",
        resourceType: "automation_task",
        resourceId: task.id,
        metadata: { updateData },
      });
    }

    // Phase 16 — reassignment notification, same convention as createTask's own.
    if (params.assignedUserId !== undefined && params.assignedUserId && params.assignedUserId !== task.assignedUserId) {
      await notificationService.notify({
        organizationId: params.organizationId,
        userId: params.assignedUserId,
        type: "task_assigned",
        title: "Task assigned to you",
        message: updated.title,
        entityType: "automation_task",
        entityId: updated.id,
      });
    }

    if (params.status === "COMPLETED" && task.status !== "COMPLETED") {
      // Real automation trigger: an ACTIVE workflow with triggerType EVENT
      // / triggerConfig.eventType "task.completed" fires from this.
      // Best-effort: never blocks or fails the task update itself.
      try {
        await eventEngine.emit({
          eventType: "task.completed",
          entityType: "automation_task",
          entityId: updated.id,
          organizationId: params.organizationId,
          actorId: params.userId,
          actorType: params.userId ? "USER" : "SYSTEM",
          sourceModule: "AUTOMATION",
          payload: { title: updated.title, sourceEntityType: updated.sourceEntityType ?? null, sourceEntityId: updated.sourceEntityId ?? null },
        });
      } catch {
        // best-effort — see comment above.
      }
    }

    return updated;
  }

  /**
   * Append a comment to a task. Stored in `metadata.comments` (append-only
   * array) rather than a dedicated table — AutomationTask already has a
   * free-form `metadata` Json column for exactly this kind of
   * lightweight, task-scoped data, so a comment thread doesn't need its
   * own schema (consistent with "only introduce database structures
   * genuinely required").
   */
  public async addComment(params: { taskId: string; organizationId: string; userId: string; text: string }) {
    const task = await prisma.automationTask.findFirst({ where: { id: params.taskId, organizationId: params.organizationId } });
    if (!task) throw new NotFoundError("Automation task not found.");

    const metadata = (task.metadata && typeof task.metadata === "object" ? (task.metadata as Record<string, any>) : {}) as Record<string, any>;
    const comments = Array.isArray(metadata.comments) ? metadata.comments : [];
    const comment = { id: crypto.randomUUID(), userId: params.userId, text: params.text, createdAt: new Date().toISOString() };
    comments.push(comment);

    const updated = await prisma.automationTask.update({
      where: { id: task.id },
      data: { metadata: { ...metadata, comments } as any },
      include: { assignedUser: { select: { id: true, firstName: true, lastName: true, email: true } } },
    });

    await auditLogRepository.record({
      organizationId: params.organizationId,
      actorUserId: params.userId,
      actorType: "USER",
      action: "AUTOMATION_TASK_COMMENTED",
      resourceType: "automation_task",
      resourceId: task.id,
      metadata: { commentId: comment.id },
    });

    // Notify the assignee (if someone else just commented) the same way a reassignment does.
    if (updated.assignedUserId && updated.assignedUserId !== params.userId) {
      await notificationService.notify({
        organizationId: params.organizationId,
        userId: updated.assignedUserId,
        type: "task_commented",
        title: "New comment on your task",
        message: `${updated.title}: ${params.text.slice(0, 140)}`,
        entityType: "automation_task",
        entityId: updated.id,
      });
    }

    return { task: updated, comment };
  }

  /**
   * List tasks with filters.
   */
  public async listTasks(params: {
    organizationId: string;
    status?: string;
    priority?: string;
    assignedUserId?: string;
    sourceWorkflowId?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 20));
    const skip = (page - 1) * limit;

    const where: Record<string, any> = { organizationId: params.organizationId };
    if (params.status) where.status = params.status;
    if (params.priority) where.priority = params.priority;
    if (params.assignedUserId) where.assignedUserId = params.assignedUserId;
    if (params.sourceWorkflowId) where.sourceWorkflowId = params.sourceWorkflowId;

    const [rows, total] = await Promise.all([
      prisma.automationTask.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          assignedUser: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          workflow: {
            select: { id: true, name: true, category: true },
          },
        },
      }),
      prisma.automationTask.count({ where }),
    ]);

    return { rows, total, page, limit };
  }

  /**
   * Phase 16 — due-soon/overdue task notifications, driven by the
   * existing cron tick (POST /automation/internal/tick, already runs
   * every minute — see automationRoutes.ts's header comment). Idempotent
   * by design: each task is notified at most once per threshold, tracked
   * via a `metadata.dueSoonNotifiedAt`/`overdueNotifiedAt` timestamp set
   * right after the notification is sent, so a tick that runs twice (or
   * every minute, which it does) never re-notifies the same task.
   */
  public async checkDueDates(): Promise<{ dueSoonNotified: number; overdueNotified: number }> {
    const now = new Date();
    const dueSoonHorizon = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const openStatus = { in: ["PENDING", "IN_PROGRESS"] as AutomationTaskStatus[] };

    const [dueSoonTasks, overdueTasks] = await Promise.all([
      prisma.automationTask.findMany({ where: { status: openStatus, assignedUserId: { not: null }, dueDate: { gte: now, lte: dueSoonHorizon } } }),
      prisma.automationTask.findMany({ where: { status: openStatus, assignedUserId: { not: null }, dueDate: { lt: now } } }),
    ]);

    let dueSoonNotified = 0;
    for (const task of dueSoonTasks) {
      const metadata = (task.metadata && typeof task.metadata === "object" ? (task.metadata as Record<string, any>) : {}) as Record<string, any>;
      if (metadata.dueSoonNotifiedAt) continue;
      await notificationService.notify({
        organizationId: task.organizationId,
        userId: task.assignedUserId,
        type: "task_due_soon",
        title: "Task due soon",
        message: task.title,
        entityType: "automation_task",
        entityId: task.id,
      });
      await prisma.automationTask.update({ where: { id: task.id }, data: { metadata: { ...metadata, dueSoonNotifiedAt: now.toISOString() } as any } });
      dueSoonNotified += 1;
    }

    let overdueNotified = 0;
    for (const task of overdueTasks) {
      const metadata = (task.metadata && typeof task.metadata === "object" ? (task.metadata as Record<string, any>) : {}) as Record<string, any>;
      if (metadata.overdueNotifiedAt) continue;
      await notificationService.notify({
        organizationId: task.organizationId,
        userId: task.assignedUserId,
        type: "task_overdue",
        title: "Task overdue",
        message: task.title,
        entityType: "automation_task",
        entityId: task.id,
      });
      await prisma.automationTask.update({ where: { id: task.id }, data: { metadata: { ...metadata, overdueNotifiedAt: now.toISOString() } as any } });
      overdueNotified += 1;
    }

    return { dueSoonNotified, overdueNotified };
  }

  /** Phase 16 — My Work: this user's own open tasks split into overdue/upcoming/other, never another user's. */
  public async getMyTasks(organizationId: string, userId: string) {
    const now = new Date();
    const upcomingHorizon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const openWhere = { organizationId, assignedUserId: userId, status: { in: ["PENDING", "IN_PROGRESS"] as AutomationTaskStatus[] } };
    const include = { workflow: { select: { id: true, name: true, category: true } } };

    const [overdue, upcoming, assigned] = await Promise.all([
      prisma.automationTask.findMany({ where: { ...openWhere, dueDate: { lt: now } }, orderBy: { dueDate: "asc" }, include }),
      prisma.automationTask.findMany({ where: { ...openWhere, dueDate: { gte: now, lte: upcomingHorizon } }, orderBy: { dueDate: "asc" }, include }),
      prisma.automationTask.findMany({ where: openWhere, orderBy: { createdAt: "desc" }, take: 50, include }),
    ]);

    return { overdue, upcoming, assigned };
  }
}

export const taskManager = TaskManager.getInstance();
