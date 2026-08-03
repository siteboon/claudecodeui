# Collaboration Domain

This context defines how employees in one company collaborate on CLI projects and sessions while retaining explicit access boundaries and accountability.

## Language

**Organization**:
The single company boundary whose Users collaborate within this deployment.
_Avoid_: Tenant, customer account, workspace

**User**:
An authenticated employee who belongs to the Organization.
_Avoid_: Account, tenant user

**Corporate Identity**:
The authoritative employee identity for a User, supplied by the Organization's Feishu tenant.
_Avoid_: Local account, application password

**Project**:
A company codebase or working directory that authorized Users collaborate on.
_Avoid_: Personal project, workspace

**Project Membership**:
The relationship that grants a User access to a Project.
_Avoid_: Project ownership, sharing flag

**Session**:
An agent or shell conversation within a Project, attributed to the User who created it and accessible according to Project Membership.
_Avoid_: Login session, authentication session
