# Contributing to ELO Performance Rater

Thank you for your interest in contributing to the ELO Performance Rating System! This document provides guidelines for contributing to the project.

## Code of Conduct

This project adheres to a code of conduct that emphasizes:
- Professional and respectful communication
- Focus on constructive feedback
- Security-first mindset for all contributions
- Adherence to military standards of excellence

## Getting Started

### Prerequisites

- Python 3.10+ with uv package manager
- Node.js 18+ and npm
- Docker and Docker Compose
- Git

### Development Setup

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/yourusername/simple_elo.git
   cd simple_elo
   ```

3. Install pre-commit hooks:
   ```bash
   uv tool install pre-commit
   pre-commit install
   ```

4. Set up the development environment:
   ```bash
   # Backend
   cd backend
   uv sync

   # Frontend
   cd ../frontend
   npm install
   ```

## Development Workflow

### 1. Create a Feature Branch

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/issue-description
```

### 2. Make Your Changes

- Follow the existing code style and patterns
- Write security-conscious code
- Add tests for new functionality
- Update documentation as needed

### 3. Run Pre-commit Checks

```bash
pre-commit run --all-files
```

This will run:
- Code formatting (Black, Prettier)
- Linting (flake8, ESLint)
- Security scans (Bandit, detect-secrets)
- Type checking (MyPy)

### 4. Test Your Changes

```bash
# Backend tests
cd backend
uv run pytest

# Frontend tests
cd frontend
npm test

# Integration tests with Docker
docker-compose up --build
```

### 5. Commit and Push

```bash
git add -A
git commit -m "feat: add new feature description"
git push origin feature/your-feature-name
```

## Contribution Guidelines

### Code Style

#### Python (Backend)
- Use Black for code formatting (line length: 88)
- Follow PEP 8 conventions
- Use type hints for all functions
- Write docstrings for all public functions
- Use Pydantic models for data validation

#### TypeScript/JavaScript (Frontend)
- Use Prettier for code formatting
- Follow ESLint rules
- Use TypeScript strict mode
- Prefer functional components with hooks
- Use proper error boundaries

### Security Requirements

All contributions must:
1. **Pass security scans**: Bandit, ESLint security plugins
2. **Validate inputs**: Use Pydantic models or proper validation
3. **Avoid hardcoded secrets**: Use environment variables
4. **Follow least privilege**: Minimize permissions and access
5. **Document security implications**: Note any security considerations

### Testing Requirements

- **Backend**: Minimum 80% test coverage with pytest
- **Frontend**: Component tests with Jest/React Testing Library
- **Integration**: Docker-based end-to-end tests
- **Security**: Include negative test cases for security validations

### Documentation Requirements

- Update README.md for user-facing changes
- Add inline code documentation
- Update API documentation for endpoint changes
- Include security considerations in documentation

## Pull Request Process

### Before Submitting

1. Ensure all pre-commit hooks pass
2. Run the full test suite
3. Update documentation
4. Test with Docker Compose
5. Check for security implications

### PR Description Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update
- [ ] Security fix

## Security Considerations
- [ ] No new security risks introduced
- [ ] Input validation added/updated
- [ ] No secrets in code
- [ ] Security testing performed

## Testing
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Manual testing completed
- [ ] Security scans pass

## Documentation
- [ ] Code comments updated
- [ ] README updated if needed
- [ ] API docs updated if needed
```

### Review Process

1. Automated checks must pass (GitHub Actions)
2. Security review by maintainer
3. Code review by at least one maintainer
4. Manual testing verification
5. Documentation review

## Issue Reporting

### Bug Reports

Use the bug report template and include:
- Clear description of the issue
- Steps to reproduce
- Expected vs actual behavior
- Environment details
- Security implications (if any)

### Feature Requests

Use the feature request template and include:
- Clear description of the feature
- Use cases and benefits
- Implementation suggestions
- Security considerations

### Security Issues

**Do not open public issues for security vulnerabilities.**
Instead, email the maintainers directly. See SECURITY.md for details.

## Development Standards

### Military-Grade Quality

This system is designed for military use, requiring:
- **Reliability**: Extensive testing and error handling
- **Security**: Defense-in-depth security measures
- **Maintainability**: Clean, documented, and testable code
- **Performance**: Efficient algorithms and resource usage
- **Auditability**: Comprehensive logging and traceability

### Performance Expectations

- API response times < 100ms for typical operations
- Frontend rendering < 50ms for UI updates
- Database queries optimized for scale
- Memory usage monitored and controlled

## Resources

- [ELO Rating System](https://en.wikipedia.org/wiki/Elo_rating_system)
- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [Next.js Documentation](https://nextjs.org/docs)
- [OWASP Security Guidelines](https://owasp.org/)

## Getting Help

- Check existing issues and documentation first
- Join project discussions on GitHub
- Contact maintainers for security-related questions
- Provide detailed context when asking for help

Thank you for contributing to the ELO Performance Rating System!
