// web/src/services/plansApi.js

const PLANS_API_URL = '/api/plans';

async function handleResponse(response) {
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Request failed' }));
        throw new Error(errorData.message || `Request failed with status ${response.status}`);
    }
    return await response.json();
}

export async function saveCurrentPlan({ userId, planData }) {
    const response = await fetch(`${PLANS_API_URL}?action=save-current`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, planData })
    });
    return await handleResponse(response);
}

export async function getCurrentPlan({ userId }) {
    const response = await fetch(`${PLANS_API_URL}?action=get-current`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
    });
    return await handleResponse(response);
}

export async function savePlan({ userId, planName, planData }) {
    const response = await fetch(`${PLANS_API_URL}?action=save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, planName, planData })
    });
    return await handleResponse(response);
}

export async function listPlans({ userId }) {
    const response = await fetch(`${PLANS_API_URL}?action=list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
    });
    return await handleResponse(response);
}

export async function loadPlan({ userId, planId }) {
    const response = await fetch(`${PLANS_API_URL}?action=load`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, planId })
    });
    return await handleResponse(response);
}

export async function deletePlan({ userId, planId }) {
    const response = await fetch(`${PLANS_API_URL}?action=delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, planId })
    });
    return await handleResponse(response);
}

export async function setActivePlan({ userId, planId }) {
    const response = await fetch(`${PLANS_API_URL}?action=set-active`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, planId })
    });
    return await handleResponse(response);
}